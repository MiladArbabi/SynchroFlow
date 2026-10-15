// apps/backend/src/services/wms/receiveJob.service.ts
import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { createStowTask } from './stow.service.js';
import { fireStowTaskAlert, fireReceiveArrivedAlert } from './wmsAlerts.service.js';
import { recomputeSupplierRating, recomputeSupplierDefectRate } from '../suppliers/supplierRating.service.js';
import { suggestStowLocation } from './locationSuggestion.service.js';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { batchConfirmUnits } from './inventoryUnit.service.js';
import { evaluateOrderConstraints } from '../constraints/constraintEngine.js';
import { projectOrderConstraints } from '../../projections/orderConstraintProjection.js';
import {
  applyReceiveJobBarcodeReadiness,
  assertReceiveJobBarcodeReady,
} from './receiveBarcodeReadiness.service.js';
import { enqueueShopSnapshotJob } from '../shop-snapshot/enqueueShopSnapshotJob.js';
import {
  ACTIVE_RECEIVE_STATUSES,
  lockReceiveJob,
  assertReceiveMutable,
  assertReceiveNotGroupFinalized,
  groupedFinalizedLineIds,
  receiveError,
} from './receiveWorkflowLock.service.js';

const SHORTFALL_ACCOUNTING_TYPES = new Set(['defect', 'wrong_item', 'wrong_variant', 'missing_item', 'other']);

/** Receive refusal with a stable machine-readable code for clients. */
function receiveCodedError(errorCode: string, message: string, statusCode = 409) {
  return Object.assign(receiveError(`${errorCode}: ${message}`, statusCode), { errorCode });
}

function shouldCountTowardShortfall(exception: any): boolean {
  // GH-1254 S4-B: held-recoverable units are physically present and captured,
  // never a shortfall, whatever their exception type.
  if (exception.accounting_role === 'held_recoverable') return false;
  if (exception.counts_toward_shortfall === true) return true;
  if (exception.accounting_role === 'shortfall') return true;
  return SHORTFALL_ACCOUNTING_TYPES.has(exception.exception_type)
    && exception.exception_type !== 'barcode_mismatch';
}

// GH-1108 / RECEIVE-OVERCOUNT-01 AUDIT CORRECTION — approval must be the
// explicit canonical accounting_role='overage' evidence "Accept extra"
// persists. exception_type='extra_item' alone is not approval: "Report
// problem" can report an extra_item exception without accounting_role set
// (see handleReportProblem's onReportException call, which never sends
// accounting_role), and that must not unlock an over-expected inspection.
function isPersistedOverageApproval(exception: any): boolean {
  return exception.accounting_role === 'overage';
}

export async function receiveLineReconciliationState(
  trx: Knex.Transaction,
  input: {
    shopId: number;
    receiveJobId: string;
    receiveJobLineId: string;
    expected: number;
    sellable?: number;
  }
) {
  const exceptions = await trx('receive_exceptions')
    .where({
      shop_id: input.shopId,
      receive_job_id: input.receiveJobId,
      receive_job_line_id: input.receiveJobLineId,
    })
    .select(
      'receive_exception_id',
      'exception_type',
      'quantity_affected',
      'notes',
      'resolved',
      'raised_at',
      'accounting_role',
      'counts_toward_shortfall',
    )
    .orderBy('raised_at', 'asc');

  const sellable = Number(input.sellable ?? 0);
  const shortfall = Math.max(0, Number(input.expected ?? 0) - sellable);
  const line = await trx('receive_job_lines').where({ shop_id: input.shopId, receive_job_id: input.receiveJobId, receive_job_line_id: input.receiveJobLineId }).first('quantity_deferred');
  const deferred = Number(line?.quantity_deferred ?? 0);
  const allocations = exceptions.map((exception: any) => ({
    receive_exception_id: exception.receive_exception_id,
    exception_type: exception.exception_type,
    quantity_affected: Number(exception.quantity_affected ?? 0),
    notes: exception.notes ?? null,
    resolved: Boolean(exception.resolved),
    raised_at: exception.raised_at,
    accounting_role: exception.accounting_role ?? null,
    counts_toward_shortfall: shouldCountTowardShortfall(exception),
  }));
  if (deferred > 0) allocations.push({ receive_exception_id: null, exception_type: 'deferred', quantity_affected: deferred, notes: null, resolved: false, raised_at: null, accounting_role: null, counts_toward_shortfall: true });
  const accounted = Math.min(
    shortfall,
    allocations
      .filter((allocation) => allocation.counts_toward_shortfall)
      .reduce((sum, allocation) => sum + allocation.quantity_affected, 0),
  );

  return {
    expected: Number(input.expected ?? 0),
    sellable,
    accounted,
    unaccounted: Math.max(0, shortfall - accounted),
    allocations,
    overage_approved: exceptions.some(isPersistedOverageApproval),
  };
}

/**
 * RECEIVE JOB SERVICE (FEAT-004)
 * --------------------------------
 * Manages the full inbound receive pipeline:
 *   PO shipped → receive job created → inspection → barcode assignment → stow_ready → closed
 *
 * Key invariants:
 * - One receive job per delivery event (split deliveries = multiple jobs per PO)
 * - quantity_received on purchase_order_line_items written only on job close
 * - stow_tasks created atomically with accepted stock credit on close
 * - actual_delivery_date written back to purchase_orders on job close → triggers rating recompute
 * - po_id on stow_tasks is application-enforced (no DB FK — migration ordering constraint)
 */

// ─────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────

export interface CreateReceiveJobInput {
  shopId: number;
  poId: string;
  operatorId?: number;
}

/**
 * Creates a receive job from a shipped PO.
 * Populates receive_job_lines from purchase_order_line_items.
 * Called explicitly via POST /suppliers/purchase-orders/:poId/receive-jobs after PO is advanced to shipped.
 * NOT auto-called by the status transition — owner/admin must trigger receive job creation manually.
 */
export async function createReceiveJob(
  trx: Knex.Transaction,
  input: CreateReceiveJobInput
): Promise<string> {
  const { shopId, poId, operatorId } = input;

  const po = await trx('purchase_orders').where({ id: poId, shop_id: shopId }).forUpdate().first();
  if (!po) throw receiveError('Purchase order not found', 404);
  if (['received', 'cancelled'].includes(po.status)) throw receiveError('PO receiving is finalized');
  const active = await trx('receive_jobs').where({ po_id: poId, shop_id: shopId }).whereIn('status', ACTIVE_RECEIVE_STATUSES).first();
  if (active) throw Object.assign(receiveError('An active receive job already exists for this PO'), { receive_job_id: active.receive_job_id });
  const lineItems = (await trx('purchase_order_line_items')
    .where({ po_id: poId, shop_id: shopId }).orderBy('id').forUpdate())
    .map((li: any) => ({ ...li, pending: li.quantity_pending_delivery == null
      ? Math.max(0, Number(li.quantity_ordered) - Number(li.quantity_received))
      : Number(li.quantity_pending_delivery) }));
  // Legacy NULL supplies only the old commitment ceiling, never physical history.
  if (!lineItems.some((li: any) => li.pending > 0)) throw receiveError('No pending delivery remains');

  if (lineItems.length === 0) {
    throw new Error(`[RECEIVE_JOB_CREATE] No line items found for PO ${poId}`);
  }

  const totalUnits = lineItems.reduce((sum: number, li: any) => sum + li.pending, 0);

  const [receiveJobId] = await trx('receive_jobs')
    .insert({
      shop_id: shopId,
      po_id: poId,
      status: 'pending',
      assigned_operator_id: operatorId ?? null,
      total_variants: lineItems.length,
      total_units: totalUnits,
      delivery_accounting_version: 2,
    })
    .returning('receive_job_id');

  const jobId = receiveJobId?.receive_job_id ?? receiveJobId;

  // Create one line per variant — with location suggestion (WM-36)
  const jobLines = await Promise.all(
    lineItems.map(async (li: any) => {
      const suggestedLocation = li.lasyncro_variant_id
        ? await suggestStowLocation(trx, { shopId, lasyncroVariantId: li.lasyncro_variant_id })
        : null;

      return {
        shop_id: shopId,
        receive_job_id: jobId,
        po_line_item_id: li.id,
        lasyncro_variant_id: li.lasyncro_variant_id,
        quantity_expected: li.pending,
        suggested_location_code: suggestedLocation ?? null,
      };
    })
  );

  await trx('receive_job_lines').insert(jobLines);

  console.info('[RECEIVE_JOB_CREATED]', { shopId, poId, jobId, totalVariants: lineItems.length, totalUnits });
  return jobId;
}

// ─────────────────────────────────────────
// INSPECT — record accepted/rejected per line
// ─────────────────────────────────────────

export interface InspectLineInput {
  shopId: number;
  receiveJobId: string;
  lasyncroVariantId: string | null;
  receiveJobLineId?: string | null;
  quantityAccepted: number;
  quantityRejected: number;
  quantityMissing?: number;
  quantityDeferred?: number;
  quantityHeldRecoverable?: number;
  deviceEventId?: string;
  requireExplicitDisposition?: boolean;
  inspectedBy: number;
  /** GH-1241 S3-B: set only by the grouped finalizer, which owns the finalization fence. */
  groupedFinalization?: boolean;
  /**
   * GH-1254 S4-B: set only by the grouped finalizer, after the held-capture gate
   * and evidence checks pass, when it captures this line's held units itself.
   */
  heldCapture?: boolean;
}

export interface UpdateReceiveLineProgressInput {
  shopId: number;
  receiveJobId: string;
  receiveJobLineId: string;
  quantitySellableProvisional: number;
  reconciliationRequired?: boolean;
  quantityDeferred?: number;
}

export async function updateReceiveJobLineProgress(
  trx: Knex.Transaction,
  input: UpdateReceiveLineProgressInput
): Promise<{
  expected: number;
  sellable: number;
  accounted: number;
  unaccounted: number;
  allocations: any[];
  overage_approved: boolean;
}> {
  const { shopId, receiveJobId, receiveJobLineId, quantitySellableProvisional, reconciliationRequired } = input;

  if (!Number.isInteger(quantitySellableProvisional) || quantitySellableProvisional < 0) {
    throw new Error('[RECEIVE_PROGRESS] quantity_sellable_provisional must be a non-negative integer');
  }

  const { job } = await lockReceiveJob(trx, shopId, receiveJobId);
  assertReceiveMutable(job);
  await assertReceiveNotGroupFinalized(trx, shopId, receiveJobId);
  const line = await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: receiveJobLineId })
    .forUpdate().first('receive_job_line_id', 'quantity_expected', 'inspection_complete', 'quantity_count_confirmed');
  if (input.quantityDeferred !== undefined && (!Number.isInteger(input.quantityDeferred) || input.quantityDeferred < 0 || input.quantityDeferred > Number(line?.quantity_expected ?? 0))) {
    throw receiveError('Invalid later-delivery quantity', 400);
  }
  if (input.quantityDeferred !== undefined && job.delivery_accounting_version !== 2) throw receiveError('Legacy job cannot persist a v2 delivery draft');

  if (!line) throw new Error(`[RECEIVE_PROGRESS] Line not found on job ${receiveJobId}`);
  if (line.inspection_complete) {
    throw new Error('[RECEIVE_PROGRESS] cannot update progress for an already inspected line');
  }

  // GH-1241 S3-A1: a draft that changes the counted quantity voids the
  // operator's confirmation under the same line lock. A metadata-only update
  // (same quantity, e.g. a later-delivery allocation) keeps it, and no draft
  // ever creates confirmation evidence.
  const countChanged = line.quantity_count_confirmed != null
    && Number(line.quantity_count_confirmed) !== quantitySellableProvisional;

  await trx('receive_job_lines')
    .where({
      shop_id: shopId,
      receive_job_id: receiveJobId,
      receive_job_line_id: receiveJobLineId,
    })
    .update({
      quantity_sellable_provisional: quantitySellableProvisional,
      ...(input.quantityDeferred !== undefined ? { quantity_deferred: input.quantityDeferred } : {}),
      ...(reconciliationRequired ? { reconciliation_started_at: new Date() } : {}),
      ...(countChanged ? CLEARED_COUNT_CONFIRMATION : {}),
      updated_at: new Date(),
    });

  return receiveLineReconciliationState(trx, {
    shopId,
    receiveJobId,
    receiveJobLineId,
    expected: Number(line.quantity_expected ?? 0),
    sellable: quantitySellableProvisional,
  });
}

const CLEARED_COUNT_CONFIRMATION = {
  quantity_count_confirmed: null,
  count_confirmed_by: null,
  count_confirmed_at: null,
  count_confirmation_event_id: null,
};

export interface ConfirmReceiveLineCountInput {
  shopId: number;
  receiveJobId: string;
  receiveJobLineId: string;
  quantityConfirmed: number;
  confirmationEventId: string;
  confirmedBy: number;
}

/**
 * GH-1241 S3-A1 — the operator's explicit physical count (0 or N) for one
 * line. This is the only writer of count-confirmation evidence, and the only
 * evidence inspection accepts: provisional drafts, reconciliation markers,
 * exceptions and the GET projection never count as a physical count.
 * Replaying the same confirmation event with the same quantity is a no-op;
 * any other reuse of the event fails closed.
 */
export async function confirmReceiveJobLineCount(
  trx: Knex.Transaction,
  input: ConfirmReceiveLineCountInput
) {
  const { shopId, receiveJobId, receiveJobLineId, quantityConfirmed, confirmationEventId, confirmedBy } = input;
  if (!Number.isSafeInteger(quantityConfirmed) || quantityConfirmed < 0) {
    throw receiveCodedError('RECEIVE_COUNT_INVALID', 'confirmed count must be a non-negative integer', 400);
  }

  const { job } = await lockReceiveJob(trx, shopId, receiveJobId);
  const line = await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: receiveJobLineId })
    .forUpdate().first();
  if (!line) throw receiveCodedError('RECEIVE_LINE_NOT_FOUND', 'Receive line not found', 404);

  // A confirmation event is consumed once, durably. Replay is a no-op only
  // while that exact event is still this line's ACTIVE confirmation; once a
  // draft edit voided it, or a newer event superseded it, or it belongs to
  // another line/quantity, reuse fails closed and can never restore evidence.
  const consumed = await trx('receive_count_confirmation_events')
    .where({ shop_id: shopId, event_id: confirmationEventId })
    .first('receive_job_line_id', 'quantity_confirmed');
  if (consumed) {
    if (consumed.receive_job_line_id === receiveJobLineId
      && Number(consumed.quantity_confirmed) === quantityConfirmed
      && line.count_confirmation_event_id === confirmationEventId) {
      return receiveLineCountState(trx, shopId, receiveJobId, receiveJobLineId);
    }
    throw receiveCodedError('RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT', 'this confirmation event was already used and is no longer the active count');
  }

  if (!ACTIVE_RECEIVE_STATUSES.includes(job.status)) {
    throw receiveCodedError('RECEIVE_JOB_TERMINAL', 'this Receive job is finished; its counts cannot change');
  }
  await assertReceiveNotGroupFinalized(trx, shopId, receiveJobId);
  if (line.inspection_complete) {
    throw receiveCodedError('RECEIVE_LINE_ALREADY_INSPECTED', 'the count of a finished line cannot change');
  }

  const confirmedAt = new Date();
  await trx('receive_count_confirmation_events').insert({
    shop_id: shopId,
    event_id: confirmationEventId,
    receive_job_line_id: receiveJobLineId,
    quantity_confirmed: quantityConfirmed,
    confirmed_by: confirmedBy,
    confirmed_at: confirmedAt,
  });
  await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: receiveJobLineId })
    .update({
      quantity_count_confirmed: quantityConfirmed,
      count_confirmed_by: confirmedBy,
      count_confirmed_at: confirmedAt,
      count_confirmation_event_id: confirmationEventId,
      // The confirmed count is the line's current draft.
      quantity_sellable_provisional: quantityConfirmed,
      updated_at: new Date(),
    });

  return receiveLineCountState(trx, shopId, receiveJobId, receiveJobLineId);
}

async function receiveLineCountState(trx: Knex.Transaction, shopId: number, receiveJobId: string, receiveJobLineId: string) {
  const line = await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: receiveJobLineId })
    .first('quantity_expected', 'quantity_count_confirmed', 'count_confirmed_at');
  return {
    quantity_count_confirmed: Number(line.quantity_count_confirmed),
    count_confirmed_at: line.count_confirmed_at,
    reconciliation: await receiveLineReconciliationState(trx, {
      shopId,
      receiveJobId,
      receiveJobLineId,
      expected: Number(line.quantity_expected ?? 0),
      sellable: Number(line.quantity_count_confirmed),
    }),
  };
}

/**
 * Records inspection result for a single variant batch.
 * Marks the line as inspection_complete.
 * Updates running counters on the parent receive_job.
 */
export async function inspectReceiveJobLine(
  trx: Knex.Transaction,
  input: InspectLineInput
): Promise<void> {

  const { shopId, receiveJobId, lasyncroVariantId, receiveJobLineId, quantityAccepted, quantityRejected, inspectedBy } = input;
  const { job } = await lockReceiveJob(trx, shopId, receiveJobId);
  if (!input.groupedFinalization) await assertReceiveNotGroupFinalized(trx, shopId, receiveJobId);
  const query = trx('receive_job_lines')
    .where({ receive_job_id: receiveJobId, shop_id: shopId });
  if (receiveJobLineId) {
    query.where({ receive_job_line_id: receiveJobLineId });
  } else if (lasyncroVariantId) {
    query.where({ lasyncro_variant_id: lasyncroVariantId });
  } else {
    throw new Error('[RECEIVE_INSPECT] Either lasyncroVariantId or receiveJobLineId required');
  }
  const line = await query.forUpdate().first();
  if (!line) throw receiveError(`[RECEIVE_INSPECT] Line not found on job ${receiveJobId}`, 404);
  if (lasyncroVariantId && line.lasyncro_variant_id !== lasyncroVariantId) throw receiveError('Receive line variant mismatch', 400);
  const expected = Number(line.quantity_expected ?? 0);
  const evidence = await trx('receive_exceptions').where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: line.receive_job_line_id });
  const canonicalMissing = evidence.filter((e: any) => e.exception_type === 'missing_item').reduce((n: number, e: any) => n + Number(e.quantity_affected), 0);
  const explicit = input.quantityMissing !== undefined && input.quantityDeferred !== undefined;
  if ((input.quantityMissing !== undefined) !== (input.quantityDeferred !== undefined)) throw receiveError('Both missing and later-delivery quantities are required', 400);
  // Only an unambiguous all-accepted old HTTP request is compatible. The
  // internal service can retain the certified canonical missing-exception
  // path used by GH-1085; it never interprets rejected as absent stock.
  if (!explicit && input.requireExplicitDisposition && (quantityAccepted < expected || quantityRejected !== 0)) {
    throw receiveError('RECEIVE_CLIENT_UPGRADE_REQUIRED: report missing vs later delivery explicitly before completing a partial line', 409);
  }
  const missing = input.quantityMissing ?? canonicalMissing;
  const deferred = input.quantityDeferred ?? 0;
  const held = input.quantityHeldRecoverable ?? 0;
  for (const q of [quantityAccepted, quantityRejected, missing, deferred, held]) {
    if (!Number.isSafeInteger(q) || q < 0) throw receiveError('Disposition quantities must be non-negative integers', 400);
  }
  // GH-1254 S4-B: held units are accepted only from the grouped finalizer, which
  // captures them atomically. Every other caller keeps the S3 refusal.
  if (held !== 0 && !(input.groupedFinalization && input.heldCapture)) {
    throw receiveError('Recoverable-held disposition requires S4 atomic capture', 409);
  }
  // Physically delivered = accepted + rejected + held (0208 CHECK definition).
  const delivered = quantityAccepted + quantityRejected + held;
  const approvedExtra = evidence.filter((e: any) => e.accounting_role === 'overage' && e.exception_type === 'extra_item')
    .reduce((n: number, e: any) => n + Number(e.quantity_affected), 0);
  const actualExtra = Math.max(0, delivered - expected);
  if (actualExtra > approvedExtra) throw receiveError('[RECEIVE_INSPECT] physical overdelivery exceeds persisted overage approval', 409);
  if (missing !== canonicalMissing) throw receiveError('Missing quantity must match canonical missing-item exceptions', 409);
  if (delivered + missing + deferred !== expected + actualExtra) throw receiveError('[RECEIVE_INSPECT] shortfall accounting must reconcile accepted, rejected, missing and deferred quantities', 409);
  if (line.inspection_complete) {
    if (input.deviceEventId && line.inspection_device_event_id === input.deviceEventId
      && Number(line.quantity_accepted) === quantityAccepted && Number(line.quantity_rejected) === quantityRejected
      && Number(line.quantity_missing) === missing && Number(line.quantity_deferred) === deferred
      && Number(line.quantity_held_recoverable ?? 0) === held) return;
    throw receiveError(`[RECEIVE_INSPECT] Line already inspected on job ${receiveJobId}`, 409);
  }
  assertReceiveMutable(job);
  if (job.delivery_accounting_version !== 2 && explicit && (missing !== 0 || deferred !== 0 || quantityRejected !== 0)) {
    throw receiveError('Legacy Receive job has unknown delivery accounting; partial cutover requires review', 409);
  }
  // GH-1241 S3-A1: accepted units require the operator's persisted physical
  // count. Nothing else — draft, reconciliation marker, exception or
  // projection — is evidence. Refused before any write.
  if (line.quantity_count_confirmed == null) {
    throw receiveCodedError('RECEIVE_COUNT_NOT_CONFIRMED', 'confirm the physical count before finishing this line (update the app if this persists)');
  }
  if (Number(line.quantity_count_confirmed) !== quantityAccepted) {
    throw receiveCodedError('RECEIVE_COUNT_MISMATCH', `accepted ${quantityAccepted} does not match the confirmed count ${line.quantity_count_confirmed}`);
  }

  await trx('receive_job_lines')
    .where({ receive_job_line_id: line.receive_job_line_id })
    .update({
      quantity_accepted: quantityAccepted,
      quantity_rejected: quantityRejected,
      ...(job.delivery_accounting_version === 2 ? { quantity_delivered: delivered, quantity_missing: missing, quantity_deferred: deferred, quantity_held_recoverable: held } : {}),
      inspected_by: inspectedBy,
      inspection_device_event_id: input.deviceEventId ?? null,
      quantity_sellable_provisional: null,
      reconciliation_started_at: null,
      inspection_complete: true,
      updated_at: new Date(),
    });

  // Update parent job counters
  await trx('receive_jobs')
    .where({ receive_job_id: receiveJobId })
    .update({
      // Physically held units were inspected too (GH-1254 S4-B); accepted/rejected stay independent.
      units_inspected: trx.raw('units_inspected + ?', [quantityAccepted + quantityRejected + held]),
      units_accepted: trx.raw('units_accepted + ?', [quantityAccepted]),
      units_rejected: trx.raw('units_rejected + ?', [quantityRejected]),
      updated_at: new Date(),
    });

  console.info('[RECEIVE_LINE_INSPECTED]', { receiveJobId, lasyncroVariantId, quantityAccepted, quantityRejected });

  // WM-46 — generate LSU- unit barcodes for all accepted units
  if (quantityAccepted > 0) {
    const variantRow = await trx('variants')
      .where({ lasyncro_variant_id: line.lasyncro_variant_id, shop_id: shopId })
      .select('barcode')
      .first();

    await batchConfirmUnits(trx, {
      shopId,
      receiveJobLineId: line.receive_job_line_id,
      lasyncroVariantId: line.lasyncro_variant_id,
      quantity: quantityAccepted,
      shopifyBarcode: variantRow?.barcode ?? null,
      createdBy: inspectedBy,
    });
  }

  /**
   * Auto-advance job status when all lines are inspection_complete.
   *
   * GH-1085: the destination is no longer a flat 'inspection'. Whether this
   * stock can be scanned decides where it goes — BYO-barcode stock is already
   * Stow-ready, while barcode-less stock owes a physical label acknowledgement
   * and parks at 'barcode_assignment'. The canonical evaluator owns that call
   * and is the same one the acknowledgement path and the close gate use.
   */
  const readiness = await applyReceiveJobBarcodeReadiness(trx, shopId, receiveJobId);
  if (readiness.allInspected) {
    console.info('[RECEIVE_JOB_ALL_LINES_INSPECTED]', {
      receiveJobId,
      status: readiness.status,
      ready: readiness.ready,
    });
  }

  await writeAuditLog(trx, {
    shopId,
    operatorId: inspectedBy,
    actionType: 'receive_inspect',
    entityType: 'receive_job',
    entityId: receiveJobId,
    metadata: { lasyncro_variant_id: lasyncroVariantId, quantity_accepted: quantityAccepted, quantity_rejected: quantityRejected },
  });
}

// ─────────────────────────────────────────
// CLOSE — write quantities + create stow tasks
// ─────────────────────────────────────────

export interface CloseReceiveJobInput {
  shopId: number;
  receiveJobId: string;
  actualDeliveryDate?: string;
  closedBy: number;
}

/**
 * REVALIDATE ORDERS AFFECTED BY RECEIVED STOCK (DF-04, 2026-07-01)
 * -------------------------------------------------------------------
 * Closes a confirmed gap: receiving stock updates inventory_truth
 * correctly, but nothing previously re-checked whether orders that
 * were blocked waiting on that exact stock could now unblock. Without
 * this, order_constraints stayed stale until an unrelated order event
 * happened to touch the same order, or an operator manually re-clicked
 * the order's "Acknowledge Stock Issue" action.
 *
 * Scope is intentionally narrow: only orders with an ACTIVE inventory
 * constraint whose target_id is one of the variants just received.
 * Not a shop-wide sweep — see demand-velocity-reorder-playbook.md §6.
 *
 * Reuses the exact evaluate → persist pair projection.engine.ts already
 * uses for the normal domain-event path (evaluateOrderConstraints +
 * projectOrderConstraints) — no new constraint-writing logic, no risk
 * of colliding with orderConstraintProjection.ts's multi-writer guard.
 *
 * order_constraints has no shop_id column (RLS-only tenant isolation
 * via a join to orders — see migration 0070) — joined explicitly here
 * rather than relying on RLS alone for a cross-order lookup.
 */
/**
 * INV-BLOCK-20 (2026-08-11): exported for the stow-confirm cascade.
 * Stock becoming *pickable* (stow into a pick bin) is the moment an
 * inventory block can actually clear — receive close lands stock at
 * ROOT, which the canonical pickable predicate excludes whenever the
 * tenant has active pick bins. Same evaluate → persist pair, one
 * definition, two triggers.
 */
export async function revalidateOrdersForReceivedVariants(
  trx: Knex.Transaction,
  shopId: number,
  receivedVariantIds: string[]
): Promise<void> {
  if (receivedVariantIds.length === 0) return;

  const affected = await trx('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .where('oc.constraint_type', 'inventory')
    .where('oc.is_active', true)
    .whereIn('oc.target_id', receivedVariantIds)
    .distinct('oc.lasyncro_order_id')
    .select('oc.lasyncro_order_id');

  if (affected.length === 0) {
    console.info('[DF04_NO_AFFECTED_ORDERS]', { shopId, receivedVariantIds });
    return;
  }

  console.info('[DF04_REVALIDATING_ORDERS]', {
    shopId,
    receivedVariantIds,
    affectedOrderCount: affected.length,
  });

  for (const row of affected) {
    const orderId = row.lasyncro_order_id;

    const orderRow = await trx('orders')
      .where({ lasyncro_order_id: orderId })
      .select('aggregate_version')
      .first();

    if (!orderRow?.aggregate_version) {
      // Same invariant projection.engine.ts enforces — log and skip
      // rather than throw, so one bad order can't abort the receive close.
      console.error('[DF04_MISSING_AGGREGATE_VERSION]', { orderId, shopId });
      continue;
    }

    try {
      const evaluations = await evaluateOrderConstraints(trx, orderId, shopId);

      /**
       * PROJECTION WRITER BYPASS (DF-04-FIX-01)
       * ----------------------------------------
       * order_constraints is guarded by enforce_projection_writer_order_constraints
       * trigger. This is a legitimate projection write (constraint revalidation
       * after stock receipt) occurring outside the projection engine's own
       * transaction — set the GUC to satisfy the trigger guard, same pattern
       * already used in rebuildInventoryProjectionForVariants.
       * SET LOCAL scopes it to this transaction only.
       */
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      await projectOrderConstraints(
        trx,
        orderId,
        shopId,
        orderRow.aggregate_version,
        new Date(),
        evaluations
      );
      console.info('[DF04_ORDER_REVALIDATED]', { orderId, shopId });
    } catch (err) {
      // Isolate failures per-order — one bad revalidation must not roll
      // back the receive job close itself.
      console.error('[DF04_REVALIDATION_FAILED]', {
        orderId,
        shopId,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * GH-1254 S4-B: a line with held units may close only when every held unit was
 * captured by its grouped finalization — Σ captures = held = held LSUs = held
 * recovery tasks. Fails closed before any Close write; never credits held units.
 */
async function assertHeldObligationsCaptured(
  trx: Knex.Transaction, shopId: number, receiveJobId: string, lines: any[], grouped: boolean
): Promise<void> {
  const heldLines = lines.filter((l: any) => Number(l.quantity_held_recoverable ?? 0) > 0);
  if (heldLines.length === 0) return;
  if (!grouped) {
    throw receiveCodedError('RECEIVE_HELD_EVIDENCE_MISSING', 'held units exist without a grouped held capture');
  }
  for (const line of heldLines) {
    const captures = await trx('receive_held_captures')
      .where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: line.receive_job_line_id })
      .select('held_capture_id', 'quantity_held');
    const captureIds = captures.map((c: any) => c.held_capture_id as string);
    const captured = captures.reduce((n: number, c: any) => n + Number(c.quantity_held), 0);
    const units = captureIds.length === 0 ? [] : await trx('inventory_units')
      .where({ shop_id: shopId }).whereIn('receive_held_capture_id', captureIds).pluck('lasyncro_unit_id');
    const tasks = units.length === 0 ? { count: 0 } : await trx('problem_center_tasks')
      .where({ shop_id: shopId }).whereIn('source_lasyncro_unit_id', units)
      .count<{ count: string }>('* as count').first();
    const held = Number(line.quantity_held_recoverable);
    if (captured !== held || units.length !== held || Number(tasks?.count ?? 0) !== held) {
      throw receiveCodedError('RECEIVE_HELD_EVIDENCE_MISSING',
        `line ${line.receive_job_line_id}: ${held} held unit(s) but ${captured} captured, ${units.length} LSU(s), ${Number(tasks?.count ?? 0)} task(s)`);
    }
  }
}

/**
 * Closes a receive job:
 * 1. Validates all lines are inspection_complete
 * 2. Writes quantity_accepted back to purchase_order_line_items.quantity_received
 * 3. Checks if PO is now fully received → advances PO status
 * 4. Creates stow_tasks for all accepted variant groups
 * 5. Requires and writes actual_delivery_date to purchase_orders
 * 6. Resolves wms:receive:arrived alert
 */
export async function closeReceiveJob(
  trx: Knex.Transaction,
  input: CloseReceiveJobInput
): Promise<void> {
  const { shopId, receiveJobId, actualDeliveryDate, closedBy } = input;

  if (!actualDeliveryDate?.trim()) {
    throw new Error('[RECEIVE_JOB_CLOSE] Actual delivery date is required');
  }

  // GH-1245 extends GH-1243's job fence with a shared PO-first lock.
  const { po, job } = await lockReceiveJob(trx, shopId, receiveJobId);
  if (job.status === 'closed') throw receiveError(`[RECEIVE_JOB_CLOSE] Already closed: ${receiveJobId}`);
  assertReceiveMutable(job);
  if (po.status === 'cancelled') throw receiveError('Cannot close Receive for a cancelled PO');

  const allLines = await trx('receive_job_lines')
    .where({ receive_job_id: receiveJobId, shop_id: shopId }).orderBy('lasyncro_variant_id').orderBy('receive_job_line_id').forUpdate();

  // GH-1241 S3-B: a grouped-finalized v2 job excludes its expected-zero lines.
  // They carry no count, inspection or delivery evidence and are never
  // written here; every other line must be in the finalization. Ordinary and
  // legacy jobs keep the full every-line gate.
  const finalizedLineIds = await groupedFinalizedLineIds(trx, shopId, receiveJobId);
  let lines = allLines;
  if (finalizedLineIds) {
    const excluded = allLines.filter((l: any) => !finalizedLineIds.has(l.receive_job_line_id));
    if (excluded.some((l: any) => Number(l.quantity_expected) !== 0)) {
      throw receiveError('Grouped reconciliation does not account for every applicable line');
    }
    lines = allLines.filter((l: any) => finalizedLineIds.has(l.receive_job_line_id));
  }

  const incomplete = lines.filter((l: any) => !l.inspection_complete);
  if (incomplete.length > 0) {
    throw new Error(`[RECEIVE_JOB_CLOSE] ${incomplete.length} lines not yet inspected on job ${receiveJobId}`);
  }

  /**
   * BARCODE READINESS GATE (GH-1085 / BARCODE-LIFECYCLE-01)
   * -------------------------------------------------------
   * Deliberately the last validation and the first thing before ANY
   * consequential write. Everything below this line — quantity_received, PO
   * status, supplier metrics, inventory_movements, inventory_truth,
   * barcode_print_jobs, stow_tasks, alerts, audit — is a side effect of
   * letting stock leave receiving, and none of it may happen for stock that
   * cannot be scanned once it reaches a bin.
   *
   * Recomputed from canonical state rather than trusting receive_jobs.status:
   * that column is a cached reflection of this same answer, and a stale or
   * hand-edited value must never be able to open the gate. Throwing here rolls
   * the caller's transaction back whole, so a refused close leaves nothing
   * behind.
   */
  if (job.delivery_accounting_version === 2 && lines.some((l: any) => l.quantity_delivered == null || l.quantity_missing == null || l.quantity_deferred == null || l.quantity_held_recoverable == null || l.quantity_held_recoverable < 0)) {
    throw receiveError('Incomplete v2 delivery accounting');
  }
  // GH-1254 S4-B: held units close with the job but are never credited. Data
  // driven (not gated) so a held-finalized job always stays closable; the held
  // obligations must be fully captured, one LSU and one task per unit.
  await assertHeldObligationsCaptured(trx, shopId, receiveJobId, lines, Boolean(finalizedLineIds));
  await assertReceiveJobBarcodeReady(trx, shopId, receiveJobId);

  // 1. Write quantity_received back to PO line items
  for (const line of lines) {
    await trx('purchase_order_line_items')
      .where({ id: line.po_line_item_id, shop_id: shopId })
      .update({
        quantity_received: trx.raw('quantity_received + ?', [line.quantity_accepted]),
        ...(job.delivery_accounting_version === 2 ? { quantity_pending_delivery: line.quantity_deferred } : {}),
        updated_at: new Date(),
      });
  }

  // 2. Write required actual_delivery_date to PO
  await trx('purchase_orders')
    .where({ id: job.po_id, shop_id: shopId })
    .update({ actual_delivery_date: actualDeliveryDate, updated_at: new Date() });

  // 3. Check if PO is now fully received
  const allLineItems = await trx('purchase_order_line_items')
    .where({ po_id: job.po_id, shop_id: shopId });

  const fullyReceived = allLineItems.every((li: any) => job.delivery_accounting_version === 2
    ? li.quantity_pending_delivery === 0
    : li.quantity_received >= li.quantity_ordered);
  const hasPartial = allLineItems.some((li: any) => li.quantity_received > 0);

  const newPoStatus = fullyReceived ? 'received' : (job.delivery_accounting_version === 2 || hasPartial) ? 'partially_received' : po.status;
  if (newPoStatus !== po.status) {
    await trx('purchase_orders')
      .where({ id: job.po_id, shop_id: shopId })
      .update({ status: newPoStatus, updated_at: new Date() });
  }

  // 3. Backfill variants.unit_cost from PO line items where cost is unknown (= 0).
  // unit_cost_cents on PO line items is the merchant's authoritative purchase cost.
  // Never overwrite a real cost — only fill the 0-placeholder left by Shopify ingestion.
  for (const line of lines) {
    if (!line.po_line_item_id || line.quantity_accepted <= 0) continue;

    const poLine = await trx('purchase_order_line_items')
      .where({ id: line.po_line_item_id, shop_id: shopId })
      .select('unit_cost_cents', 'lasyncro_variant_id')
      .first();

    if (!poLine?.unit_cost_cents || poLine.unit_cost_cents <= 0) continue;
    if (!poLine.lasyncro_variant_id) continue;

    await trx('variants')
      .where({ lasyncro_variant_id: poLine.lasyncro_variant_id, shop_id: shopId })
      .where('unit_cost', 0) // only fill placeholder — never overwrite real cost
      .update({
        unit_cost: poLine.unit_cost_cents / 100,
        updated_at: new Date(),
      });
  }

  // 3a. Increment supplier total_pos on full receipt — mirrors httpUpdatePoStatus behaviour
  if (fullyReceived && po.status !== 'received') {
    await trx('suppliers')
      .where({ id: po.supplier_id, shop_id: shopId })
      .increment('total_pos', 1);
  }

  // 3b. Recompute supplier rating — on_time_rate, fill_rate, avg_delivery_days
  await recomputeSupplierRating(trx, shopId, po.supplier_id);
  // 3c. Recompute defect_rate from receive_exceptions (defect type only)
  await recomputeSupplierDefectRate(trx, shopId, po.supplier_id);

  /**
   * INVENTORY WRITE ON RECEIVE CLOSE (INV-01)
   * ------------------------------------------
   * Write inbound_purchase movement immediately on receive close.
   * Stock becomes available at WH-{shopId}-ROOT (unlocated).
   * Stow confirm later writes TWO location_transfer movements (debit ROOT,
   * credit bin) AND updates inventory_truth — see stow.service.ts header.
   * Truth is never written without a movement that reproduces it (INV-LEDGER-BYPASS-16).
   *
   * Invariant: available_quantity = on_hand_quantity - reserved_quantity
   * Movement is append-only — never updated after insert.
   *
   * Audit: reference_type='receive_job', reference_id=receiveJobId
   */
  const RECEIVE_NAMESPACE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  for (const line of lines) {
    if (line.quantity_accepted <= 0) continue;
    if (!line.lasyncro_variant_id) continue; 
    // unlinked line — no inventory write, no barcode, no stow task

    const rootLocation = `WH-${shopId}-ROOT`;
    const movementId = uuidv5(
      `${receiveJobId}:${line.lasyncro_variant_id}:inbound_purchase`,
      RECEIVE_NAMESPACE
    );
    const deviceEventId = uuidv5(
      `${receiveJobId}:${line.lasyncro_variant_id}:device`,
      RECEIVE_NAMESPACE
    );

    const insertedMovements = await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: movementId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: 'inbound_purchase',
        quantity_delta: line.quantity_accepted,
        location_code: rootLocation,
        reference_type: 'receive_job',
        reference_id: receiveJobId,
        platform: 'wms',
        occurred_at: new Date(),
        device_event_id: deviceEventId,
        operator_id: closedBy,  // traceability: operator who received stock
        triggered_by: 'receive_job',      // traceability: source of movement
      })
      .onConflict(['device_event_id'])
      .ignore()
      .returning('lasyncro_inventory_movement_id');

    /**
     * GH-1243: the inbound_purchase movement is the receipt. Its identity is
     * one per (job, variant) — receive_job_lines_variant_unique allows one
     * linked line per variant — so a first close always inserts it. An
     * ignored insert means this receipt already exists in the ledger: crediting
     * truth, PO quantities or Stow on top of it would be a second receipt.
     * Throwing rolls the whole close back.
     */
    if (insertedMovements.length !== 1) {
      throw new Error(
        `[RECEIVE_JOB_CLOSE] INBOUND_MOVEMENT_CONFLICT: inbound receipt already recorded for job ${receiveJobId} variant ${line.lasyncro_variant_id}`
      );
    }

    // Upsert inventory_truth — increment on_hand and available at ROOT
    await trx('inventory_truth')
    .insert({
      shop_id: shopId,
      lasyncro_variant_id: line.lasyncro_variant_id,
      location_code: rootLocation,
      on_hand_quantity: line.quantity_accepted,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: line.quantity_accepted,
      last_evaluated_at: new Date(),
    })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + ?', [line.quantity_accepted]),
        available_quantity: trx.raw('inventory_truth.available_quantity + ?', [line.quantity_accepted]),
        last_evaluated_at: new Date(),
        updated_at: new Date(),
      });

    /**
     * BARCODE GENERATION ON RECEIVE CLOSE (BAR-01)
     * ----------------------------------------------
     * One barcode per variant — shared across all units of same SKU.
     * barcode_value = SKU if available, else short variant ID.
     * Operator prints and attaches to product packaging before stow.
     */
    const variant = await trx('variants')
      .where({ lasyncro_variant_id: line.lasyncro_variant_id, shop_id: shopId })
      .select('sku')
      .first();

    const barcodeValue = variant?.sku?.trim()
      ? variant.sku.trim()
      : line.lasyncro_variant_id.replace(/-/g, '').slice(0, 12).toUpperCase();

    await trx('barcode_print_jobs')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        quantity: line.quantity_accepted,
        barcode_value: barcodeValue,
        status: 'pending',
        created_by: closedBy,
      })
      .onConflict(['shop_id', 'receive_job_id', 'lasyncro_variant_id'])
      .merge({
        quantity: line.quantity_accepted,
        barcode_value: barcodeValue,
        status: 'pending',
        updated_at: new Date(),
      });
  }

  // 4. Create stow tasks for accepted units (quantity > 0 only)
  // Skip unlinked lines — no variant ID means no stow task can be created
  for (const line of lines) {
    if (line.quantity_accepted <= 0) continue;
    if (!line.lasyncro_variant_id) continue;

    const stowTaskId = await createStowTask(trx, {
      shopId,
      lasyncroVariantId: line.lasyncro_variant_id,
      quantity: line.quantity_accepted,
      trigger: 'inbound_stock',
      poId: job.po_id,
      receiveJobLineId: line.receive_job_line_id,
      // WM-36: use suggested location from receive_job_lines if available.
      // Operator can still override via PATCH /stow-tasks/:taskId/location.
      locationCode: line.suggested_location_code ?? undefined,
    });

    await fireStowTaskAlert(trx, {
      shopId,
      stowTaskId,
      isActive: true,
      trigger: 'inbound_stock',
    });
  }

  // 5. Close the job
  await trx('receive_jobs')
    .where({ receive_job_id: receiveJobId })
    .update({
      status: 'closed',
      closed_at: new Date(),
      actual_delivery_date: actualDeliveryDate,
      closed_by: closedBy,
      updated_at: new Date(),
    });

  // 6. Resolve wms:receive:arrived alert — no further operator action needed
  const supplier = await trx('suppliers').where({ id: po.supplier_id, shop_id: shopId }).first();
  await fireReceiveArrivedAlert(trx, {
    shopId,
    poId: job.po_id,
    supplierName: supplier?.name ?? 'Unknown supplier',
    isActive: false,
  });

  console.info('[RECEIVE_JOB_CLOSED]', { shopId, receiveJobId, poId: job.po_id, newPoStatus, closedBy });
    await writeAuditLog(trx, {
      shopId,
      operatorId: closedBy,
      actionType: 'receive_close',
      entityType: 'receive_job',
      entityId: receiveJobId,
      metadata: { po_id: job.po_id, po_status: newPoStatus },
    });

    // DF-04 — revalidate orders that were blocked waiting on the variants
    // just received. Same trx, same atomic scope as the receive close.
    const receivedVariantIds = [
      ...new Set(
        lines
          .filter((l: any) => l.quantity_accepted > 0 && l.lasyncro_variant_id)
          .map((l: any) => l.lasyncro_variant_id as string)
      ),
    ];
    await revalidateOrdersForReceivedVariants(trx, shopId, receivedVariantIds);
    await enqueueShopSnapshotJob(trx, shopId);
}
