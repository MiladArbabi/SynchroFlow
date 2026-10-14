// apps/backend/src/services/wms/receiveReconciliation.service.ts
import { Knex } from 'knex';
import { createHash } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { lockReceiveJob, assertReceiveMutable, receiveError } from './receiveWorkflowLock.service.js';
import { inspectReceiveJobLine } from './receiveJob.service.js';
import { applyReceiveJobBarcodeReadiness } from './receiveBarcodeReadiness.service.js';
import { fireReceiveExceptionAlert } from './wmsAlerts.service.js';
import { writeAuditLog } from '../audit/operatorAudit.service.js';

/**
 * GROUPED RECEIVE RECONCILIATION (GH-1241 S3-B)
 * ---------------------------------------------
 * One job-scoped reconciliation accounts for every applicable line at the end
 * of Receive. Per applicable line (quantity_expected > 0):
 *
 *   accepted + physically_rejected + missing + deferred
 *     = expected + explicitly approved overage
 *
 * Drafts are append-only revisions; a revision is superseded by the one that
 * names it as base. Drafts never write canonical exceptions, counts,
 * inspections, LSUs or stock.
 *
 * Finalization binds the CURRENT revision and its exact canonical payload, then
 * in ONE transaction, under the canonical PO → job → line lock order:
 *   creates the group's new discrepancy evidence as canonical receive_exceptions,
 *   links explicitly referenced preexisting evidence, runs the certified per-line
 *   inspection (S3-A1 confirmed count, GH-1245 accounting equality, persisted
 *   overage approval, held = S4 refusal, LSU minting, job counters, audit), and
 *   persists the immutable finalization evidence. Any refusal rolls back all of it.
 * Stock, truth, movements and Stow remain the normal close's responsibility.
 *
 * Opt-in: jobs that never use these endpoints keep the existing per-line flow.
 * After finalization the per-line accounting writers refuse
 * (assertReceiveNotGroupFinalized); post-final correction is a future
 * compensating workflow.
 */

const RECONCILIATION_NAMESPACE = 'b3f0d0a6-5c2e-4f8e-9a51-1241000053b0';

/** New discrepancy evidence the group may report: physical rejection or absence only. */
const GROUPED_EXCEPTION_TYPES = new Set(['missing_item', 'defect', 'packaging_damage', 'wrong_item', 'wrong_variant']);
const SHORTFALL_DEFAULT_TYPES = new Set(['missing_item', 'defect', 'wrong_item', 'wrong_variant']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function reconciliationError(code: string, message: string, statusCode = 409) {
  return Object.assign(receiveError(`${code}: ${message}`, statusCode), { errorCode: code });
}

export interface GroupedNewException {
  exception_type: string;
  quantity_affected: number;
  accounting_role: string | null;
  notes: string | null;
}

export interface GroupedLine {
  receive_job_line_id: string;
  quantity_accepted: number;
  quantity_rejected: number;
  quantity_missing: number;
  quantity_deferred: number;
  quantity_held_recoverable: number;
  new_exceptions: GroupedNewException[];
  existing_exception_ids: string[];
}

const isQuantity = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Validates request lines and returns them in canonical form: lines ordered by
 * line id, evidence and references ordered, explicit defaults. Line order and
 * omitted optional fields therefore never change payload identity.
 */
export function parseGroupedLines(raw: unknown): GroupedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw reconciliationError('RECEIVE_RECONCILIATION_LINES_REQUIRED', 'lines must be a non-empty array', 400);
  }
  const lines = raw.map((entry: any): GroupedLine => {
    const id = entry?.receive_job_line_id;
    if (!isEventId(id)) throw reconciliationError('RECEIVE_RECONCILIATION_LINE_INVALID', 'receive_job_line_id must be a UUID', 400);
    const held = entry.quantity_held_recoverable ?? 0;
    for (const q of [entry.quantity_accepted, entry.quantity_rejected, entry.quantity_missing, entry.quantity_deferred, held]) {
      if (!isQuantity(q)) throw reconciliationError('RECEIVE_RECONCILIATION_LINE_INVALID', `line ${id}: quantities must be non-negative integers`, 400);
    }
    const newExceptions = entry.new_exceptions ?? [];
    const existing = entry.existing_exception_ids ?? [];
    if (!Array.isArray(newExceptions) || !Array.isArray(existing)) {
      throw reconciliationError('RECEIVE_RECONCILIATION_LINE_INVALID', `line ${id}: new_exceptions and existing_exception_ids must be arrays`, 400);
    }
    if (existing.some((x: unknown) => !isEventId(x)) || new Set(existing).size !== existing.length) {
      throw reconciliationError('RECEIVE_RECONCILIATION_LINE_INVALID', `line ${id}: existing_exception_ids must be distinct UUIDs`, 400);
    }
    return {
      receive_job_line_id: id.toLowerCase(),
      quantity_accepted: entry.quantity_accepted,
      quantity_rejected: entry.quantity_rejected,
      quantity_missing: entry.quantity_missing,
      quantity_deferred: entry.quantity_deferred,
      quantity_held_recoverable: held,
      new_exceptions: newExceptions.map((e: any) => parseNewException(id, e))
        .sort((a: GroupedNewException, b: GroupedNewException) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      existing_exception_ids: existing.map((x: string) => x.toLowerCase()).sort(),
    };
  });
  lines.sort((a, b) => a.receive_job_line_id.localeCompare(b.receive_job_line_id));
  if (new Set(lines.map((l) => l.receive_job_line_id)).size !== lines.length) {
    throw reconciliationError('RECEIVE_RECONCILIATION_LINE_INVALID', 'each line may appear once', 400);
  }
  return lines;
}

function parseNewException(lineId: string, e: any): GroupedNewException {
  const type = e?.exception_type;
  if (!GROUPED_EXCEPTION_TYPES.has(type)) {
    throw reconciliationError('RECEIVE_RECONCILIATION_EXCEPTION_INVALID',
      `line ${lineId}: grouped evidence may report ${[...GROUPED_EXCEPTION_TYPES].join(', ')}`, 400);
  }
  if (!Number.isSafeInteger(e.quantity_affected) || e.quantity_affected <= 0) {
    throw reconciliationError('RECEIVE_RECONCILIATION_EXCEPTION_INVALID', `line ${lineId}: quantity_affected must be a positive integer`, 400);
  }
  const role = e.accounting_role ?? (SHORTFALL_DEFAULT_TYPES.has(type) ? 'shortfall' : null);
  // Overage approval is never inferred from a payload; missing is always shortfall.
  if (role !== null && role !== 'shortfall') {
    throw reconciliationError('RECEIVE_RECONCILIATION_EXCEPTION_INVALID', `line ${lineId}: grouped evidence cannot carry accounting_role ${role}`, 400);
  }
  if (type === 'missing_item' && role !== 'shortfall') {
    throw reconciliationError('RECEIVE_RECONCILIATION_EXCEPTION_INVALID', `line ${lineId}: missing_item is shortfall evidence`, 400);
  }
  if (e.notes != null && typeof e.notes !== 'string') {
    throw reconciliationError('RECEIVE_RECONCILIATION_EXCEPTION_INVALID', `line ${lineId}: notes must be a string`, 400);
  }
  return { exception_type: type, quantity_affected: e.quantity_affected, accounting_role: role, notes: e.notes ?? null };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const linesHash = (lines: GroupedLine[]) => hash(lines);
const finalizationHash = (revisionId: string, lines: GroupedLine[]) => hash({ revision_id: revisionId.toLowerCase(), lines });

async function currentRevision(trx: Knex.Transaction, shopId: number, jobId: string) {
  return trx('receive_reconciliation_revisions')
    .where({ shop_id: shopId, receive_job_id: jobId })
    .orderBy('revision_number', 'desc')
    .first();
}

async function finalizationOf(trx: Knex.Transaction, shopId: number, jobId: string) {
  return trx('receive_reconciliation_finalizations').where({ shop_id: shopId, receive_job_id: jobId }).first();
}

/** Grouped reconciliation is a v2, still-active, not-yet-finalized Receive. */
async function assertGroupedWritable(trx: Knex.Transaction, shopId: number, job: any) {
  if (Number(job.delivery_accounting_version) !== 2) {
    throw reconciliationError('RECEIVE_RECONCILIATION_LEGACY_UNSUPPORTED',
      'legacy Receive jobs have unknown delivery accounting and cannot be reconciled as a group');
  }
  try {
    assertReceiveMutable(job);
  } catch {
    throw reconciliationError('RECEIVE_JOB_TERMINAL', 'this Receive job is finished');
  }
  if (await finalizationOf(trx, shopId, job.receive_job_id)) {
    throw reconciliationError('RECEIVE_RECONCILIATION_FINALIZED', 'this Receive was already finalized as a group');
  }
}

function revisionResult(row: any) {
  return {
    revision_id: row.revision_id,
    revision_number: Number(row.revision_number),
    base_revision_id: row.base_revision_id ?? null,
  };
}

// ─────────────────────────────────────────
// DRAFT — append a superseding revision
// ─────────────────────────────────────────

export async function saveReconciliationDraft(
  trx: Knex.Transaction,
  input: { shopId: number; receiveJobId: string; baseRevisionId: string | null; deviceEventId: string; lines: GroupedLine[]; actorId: number }
) {
  const { shopId, receiveJobId, deviceEventId, lines, actorId } = input;
  const baseRevisionId = input.baseRevisionId?.toLowerCase() ?? null;
  const { job } = await lockReceiveJob(trx, shopId, receiveJobId);
  const payloadHash = linesHash(lines);

  // A draft event is consumed once: an exact replay returns its revision.
  const replay = await trx('receive_reconciliation_revisions').where({ shop_id: shopId, device_event_id: deviceEventId }).first();
  if (replay) {
    if (replay.receive_job_id === receiveJobId && replay.payload_hash === payloadHash
      && (replay.base_revision_id ?? null) === baseRevisionId) return revisionResult(replay);
    throw reconciliationError('RECEIVE_RECONCILIATION_REPLAY_CONFLICT', 'this draft event was already used for a different revision');
  }

  await assertGroupedWritable(trx, shopId, job);
  const jobLineIds = new Set((await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId }).select('receive_job_line_id'))
    .map((r: any) => r.receive_job_line_id as string));
  const unknown = lines.find((l) => !jobLineIds.has(l.receive_job_line_id));
  if (unknown) throw reconciliationError('RECEIVE_RECONCILIATION_LINE_UNKNOWN', `line ${unknown.receive_job_line_id} is not on this Receive job`, 400);

  const current = await currentRevision(trx, shopId, receiveJobId);
  if ((current?.revision_id ?? null) !== baseRevisionId) {
    throw reconciliationError('RECEIVE_RECONCILIATION_REVISION_STALE', 'the draft changed since this revision; reload and amend the current revision');
  }

  const [row] = await trx('receive_reconciliation_revisions')
    .insert({
      shop_id: shopId,
      receive_job_id: receiveJobId,
      revision_number: Number(current?.revision_number ?? 0) + 1,
      base_revision_id: baseRevisionId,
      device_event_id: deviceEventId,
      payload: JSON.stringify(lines),
      payload_hash: payloadHash,
      created_by: actorId,
    })
    .returning('*');
  return revisionResult(row);
}

// ─────────────────────────────────────────
// FINALIZE — one atomic grouped transaction
// ─────────────────────────────────────────

function finalizationResult(row: any) {
  return {
    status: 'finalized',
    reconciliation_id: row.reconciliation_id,
    revision_id: row.revision_id,
    receive_job_id: row.receive_job_id,
    device_event_id: row.device_event_id,
    finalized_at: row.finalized_at,
  };
}

export async function finalizeReconciliation(
  trx: Knex.Transaction,
  input: { shopId: number; receiveJobId: string; currentRevisionId: string; deviceEventId: string; lines: GroupedLine[]; actorId: number }
) {
  const { shopId, receiveJobId, deviceEventId, lines, actorId } = input;
  const revisionId = input.currentRevisionId.toLowerCase();
  // 1. PO → job (FOR UPDATE). Competing finalizations serialize here.
  const { po, job } = await lockReceiveJob(trx, shopId, receiveJobId);
  const payloadHash = finalizationHash(revisionId, lines);

  // 2. Idempotency and immutability, decided under the lock.
  const existing = await finalizationOf(trx, shopId, receiveJobId);
  if (existing) {
    if (existing.device_event_id === deviceEventId && existing.payload_hash === payloadHash) return finalizationResult(existing);
    if (existing.device_event_id === deviceEventId) {
      throw reconciliationError('RECEIVE_RECONCILIATION_REPLAY_CONFLICT', 'this finalization event was already used with a different payload');
    }
    throw reconciliationError('RECEIVE_RECONCILIATION_FINALIZED', 'this Receive was already finalized as a group');
  }
  const eventUsed = await trx('receive_reconciliation_finalizations').where({ shop_id: shopId, device_event_id: deviceEventId }).first('reconciliation_id');
  if (eventUsed) throw reconciliationError('RECEIVE_RECONCILIATION_REPLAY_CONFLICT', 'this finalization event was already used');
  await assertGroupedWritable(trx, shopId, job);

  // 3. Bind the current revision and its exact canonical payload.
  const current = await currentRevision(trx, shopId, receiveJobId);
  if (!current) throw reconciliationError('RECEIVE_RECONCILIATION_REVISION_REQUIRED', 'save a draft revision before finalizing');
  if (current.revision_id !== revisionId) {
    throw reconciliationError('RECEIVE_RECONCILIATION_REVISION_STALE', 'only the current draft revision can be finalized');
  }
  if (current.payload_hash !== linesHash(lines)) {
    throw reconciliationError('RECEIVE_RECONCILIATION_PAYLOAD_MISMATCH', 'the submitted lines differ from the current draft revision');
  }

  // 4. Lines (FOR UPDATE, stable order): exactly the applicable lines, all unfinished.
  const jobLines = await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId })
    .orderBy('receive_job_line_id').forUpdate();
  const byId = new Map(jobLines.map((l: any) => [l.receive_job_line_id as string, l]));
  for (const line of lines) {
    const row = byId.get(line.receive_job_line_id);
    if (!row) throw reconciliationError('RECEIVE_RECONCILIATION_LINE_UNKNOWN', `line ${line.receive_job_line_id} is not on this Receive job`, 400);
    if (Number(row.quantity_expected) <= 0) {
      throw reconciliationError('RECEIVE_RECONCILIATION_LINE_NOT_APPLICABLE', `line ${line.receive_job_line_id} has nothing outstanding and is excluded`);
    }
  }
  const submitted = new Set(lines.map((l) => l.receive_job_line_id));
  const omitted = jobLines.filter((l: any) => Number(l.quantity_expected) > 0 && !submitted.has(l.receive_job_line_id));
  if (omitted.length > 0) {
    throw reconciliationError('RECEIVE_RECONCILIATION_LINES_INCOMPLETE', `${omitted.length} applicable line(s) are not accounted for`);
  }
  const finished = lines.find((l) => byId.get(l.receive_job_line_id).inspection_complete);
  if (finished) {
    throw reconciliationError('RECEIVE_RECONCILIATION_LINE_ALREADY_FINISHED', `line ${finished.receive_job_line_id} was already finished on the per-line path`);
  }
  // GH-1241 S3C-E0: expected-zero lines are excluded from finalization, close
  // and readiness. One already inspected or holding accepted physical stock
  // would be dropped from receipt, so the group fails closed instead.
  const finishedExcluded = jobLines.find((l: any) => Number(l.quantity_expected) <= 0
    && (l.inspection_complete || Number(l.quantity_accepted ?? 0) > 0));
  if (finishedExcluded) {
    throw reconciliationError('RECEIVE_RECONCILIATION_LINE_ALREADY_FINISHED',
      `excluded line ${finishedExcluded.receive_job_line_id} was already finished on the per-line path`);
  }

  // 5. Immutable finalization header, then each line in lock order.
  const [finalization] = await trx('receive_reconciliation_finalizations')
    .insert({
      shop_id: shopId,
      receive_job_id: receiveJobId,
      po_id: po.id,
      revision_id: revisionId,
      device_event_id: deviceEventId,
      payload_hash: payloadHash,
      finalized_by: actorId,
    })
    .returning('*');

  for (const line of lines) {
    await finalizeLine(trx, { shopId, receiveJobId, finalization, line, row: byId.get(line.receive_job_line_id), actorId });
  }

  // 6. Readiness now sees the finalization (expected-zero lines excluded).
  await applyReceiveJobBarcodeReadiness(trx, shopId, receiveJobId);
  await writeAuditLog(trx, {
    shopId,
    operatorId: actorId,
    actionType: 'receive_reconcile_finalize',
    entityType: 'receive_job',
    entityId: receiveJobId,
    metadata: { reconciliation_id: finalization.reconciliation_id, revision_id: revisionId, lines: lines.length },
  });
  console.info('[RECEIVE_RECONCILIATION_FINALIZED]', { shopId, receiveJobId, reconciliationId: finalization.reconciliation_id, lines: lines.length });
  return finalizationResult(finalization);
}

async function finalizeLine(
  trx: Knex.Transaction,
  ctx: { shopId: number; receiveJobId: string; finalization: any; line: GroupedLine; row: any; actorId: number }
) {
  const { shopId, receiveJobId, finalization, line, row, actorId } = ctx;
  const lineId = line.receive_job_line_id;
  const evidence = await trx('receive_exceptions')
    .where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: lineId })
    .select('receive_exception_id', 'exception_type');
  const evidenceIds = new Set(evidence.map((e: any) => e.receive_exception_id as string));

  // Preexisting evidence is reused only by explicit reference; canonical missing
  // evidence that is not referenced would be silently double- or under-counted.
  const foreign = line.existing_exception_ids.find((id) => !evidenceIds.has(id));
  if (foreign) throw reconciliationError('RECEIVE_RECONCILIATION_EVIDENCE_UNKNOWN', `line ${lineId}: exception ${foreign} is not evidence of this line`);
  const unreferenced = evidence.find((e: any) => e.exception_type === 'missing_item' && !line.existing_exception_ids.includes(e.receive_exception_id));
  if (unreferenced) {
    throw reconciliationError('RECEIVE_RECONCILIATION_EVIDENCE_UNREFERENCED', `line ${lineId}: reference existing missing evidence ${unreferenced.receive_exception_id} explicitly`);
  }
  if (row.quantity_count_confirmed == null) {
    throw reconciliationError('RECEIVE_COUNT_NOT_CONFIRMED', `line ${lineId}: confirm the physical count before finalizing`);
  }

  const created: string[] = [];
  for (const e of line.new_exceptions) {
    const [inserted] = await trx('receive_exceptions')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        receive_job_line_id: lineId,
        lasyncro_variant_id: row.lasyncro_variant_id,
        exception_type: e.exception_type,
        quantity_affected: e.quantity_affected,
        accounting_role: e.accounting_role,
        counts_toward_shortfall: e.accounting_role === 'shortfall',
        notes: e.notes ?? 'Reported in grouped Receive reconciliation',
        raised_by: actorId,
        raised_at: new Date(),
      })
      .returning('receive_exception_id');
    created.push(inserted.receive_exception_id ?? inserted);
    if (row.lasyncro_variant_id) {
      await fireReceiveExceptionAlert(trx, {
        shopId, receiveJobId, lasyncroVariantId: row.lasyncro_variant_id, exceptionType: e.exception_type,
      });
    }
  }

  // The certified per-line finish: count basis, accounting equality, overage
  // approval, held refusal, LSUs, counters, readiness and audit.
  try {
    await inspectReceiveJobLine(trx, {
      shopId,
      receiveJobId,
      lasyncroVariantId: row.lasyncro_variant_id ?? null,
      receiveJobLineId: lineId,
      quantityAccepted: line.quantity_accepted,
      quantityRejected: line.quantity_rejected,
      quantityMissing: line.quantity_missing,
      quantityDeferred: line.quantity_deferred,
      quantityHeldRecoverable: line.quantity_held_recoverable,
      deviceEventId: uuidv5(`${finalization.device_event_id}:${lineId}`, RECONCILIATION_NAMESPACE),
      requireExplicitDisposition: true,
      inspectedBy: actorId,
      groupedFinalization: true,
    });
  } catch (err: any) {
    if (!err?.statusCode) throw err;
    throw reconciliationError(err.errorCode ?? 'RECEIVE_RECONCILIATION_LINE_INVALID', `line ${lineId}: ${err.message}`, err.statusCode);
  }

  const delivered = line.quantity_accepted + line.quantity_rejected;
  await trx('receive_reconciliation_finalization_lines').insert({
    shop_id: shopId,
    reconciliation_id: finalization.reconciliation_id,
    receive_job_id: receiveJobId,
    receive_job_line_id: lineId,
    quantity_expected: Number(row.quantity_expected),
    quantity_count_confirmed: Number(row.quantity_count_confirmed),
    count_confirmation_event_id: row.count_confirmation_event_id,
    quantity_accepted: line.quantity_accepted,
    quantity_rejected: line.quantity_rejected,
    quantity_missing: line.quantity_missing,
    quantity_deferred: line.quantity_deferred,
    quantity_overage_approved: Math.max(0, delivered - Number(row.quantity_expected)),
  });

  const links = [
    ...created.map((id) => ({ id, kind: 'created' })),
    ...line.existing_exception_ids.map((id) => ({ id, kind: 'referenced' })),
  ];
  if (links.length > 0) {
    await trx('receive_reconciliation_exception_links').insert(links.map((l) => ({
      shop_id: shopId,
      receive_exception_id: l.id,
      reconciliation_id: finalization.reconciliation_id,
      receive_job_line_id: lineId,
      link_kind: l.kind,
    })));
  }
}

// ─────────────────────────────────────────
// READ
// ─────────────────────────────────────────

export async function readReconciliation(trx: Knex.Transaction, shopId: number, receiveJobId: string) {
  const job = await trx('receive_jobs').where({ shop_id: shopId, receive_job_id: receiveJobId })
    .first('receive_job_id', 'po_id', 'status', 'delivery_accounting_version');
  if (!job) throw reconciliationError('RECEIVE_JOB_NOT_FOUND', 'Receive job not found', 404);

  const revisions = await trx('receive_reconciliation_revisions')
    .where({ shop_id: shopId, receive_job_id: receiveJobId }).orderBy('revision_number', 'asc');
  const current = revisions[revisions.length - 1] ?? null;
  const finalization = await finalizationOf(trx, shopId, receiveJobId);

  // Active, applicable lines only: expected-zero lines are excluded, never invented.
  const lines = await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId })
    .where('quantity_expected', '>', 0)
    .orderBy('receive_job_line_id')
    .select('receive_job_line_id', 'po_line_item_id', 'lasyncro_variant_id', 'quantity_expected',
      'quantity_count_confirmed', 'count_confirmation_event_id', 'inspection_complete');

  let finalizationView: Record<string, unknown> | null = null;
  if (finalization) {
    const finalLines = await trx('receive_reconciliation_finalization_lines')
      .where({ shop_id: shopId, reconciliation_id: finalization.reconciliation_id }).orderBy('receive_job_line_id');
    const links = await trx('receive_reconciliation_exception_links')
      .where({ shop_id: shopId, reconciliation_id: finalization.reconciliation_id }).orderBy('receive_exception_id');
    finalizationView = {
      reconciliation_id: finalization.reconciliation_id,
      revision_id: finalization.revision_id,
      device_event_id: finalization.device_event_id,
      finalized_by: finalization.finalized_by,
      finalized_at: finalization.finalized_at,
      lines: finalLines.map((l: any) => ({
        receive_job_line_id: l.receive_job_line_id,
        quantity_expected: Number(l.quantity_expected),
        quantity_count_confirmed: Number(l.quantity_count_confirmed),
        count_confirmation_event_id: l.count_confirmation_event_id,
        quantity_accepted: Number(l.quantity_accepted),
        quantity_rejected: Number(l.quantity_rejected),
        quantity_missing: Number(l.quantity_missing),
        quantity_deferred: Number(l.quantity_deferred),
        quantity_overage_approved: Number(l.quantity_overage_approved),
        created_exception_ids: links.filter((k: any) => k.receive_job_line_id === l.receive_job_line_id && k.link_kind === 'created')
          .map((k: any) => k.receive_exception_id),
        referenced_exception_ids: links.filter((k: any) => k.receive_job_line_id === l.receive_job_line_id && k.link_kind === 'referenced')
          .map((k: any) => k.receive_exception_id),
      })),
    };
  }

  return {
    receive_job_id: receiveJobId,
    status: finalization ? 'finalized' : current ? 'draft' : 'open',
    current_revision_id: current?.revision_id ?? null,
    revisions: revisions.map((r: any) => ({
      revision_id: r.revision_id,
      revision_number: Number(r.revision_number),
      base_revision_id: r.base_revision_id ?? null,
      status: r === current ? 'current' : 'superseded',
      created_by: r.created_by ?? null,
      created_at: r.created_at,
      lines: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    })),
    lines: lines.map((l: any) => ({
      receive_job_line_id: l.receive_job_line_id,
      po_line_item_id: l.po_line_item_id,
      lasyncro_variant_id: l.lasyncro_variant_id,
      quantity_expected: Number(l.quantity_expected),
      quantity_count_confirmed: l.quantity_count_confirmed == null ? null : Number(l.quantity_count_confirmed),
      count_state: l.quantity_count_confirmed == null ? 'not_counted' : 'confirmed',
      inspection_complete: Boolean(l.inspection_complete),
    })),
    finalization: finalizationView,
  };
}
