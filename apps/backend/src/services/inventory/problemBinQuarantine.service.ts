import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { lockStowDestinationHierarchy, assertStowDestinationEligible } from '../wms/stowDestinationEligibility.service.js';
import { resolveActiveProblemBin } from '../wms/receiveHeldCustody.service.js';
import { pickableLocationCondition } from './pickableLocation.js';
import { writeAuditLog } from '../audit/operatorAudit.service.js';

export const QUARANTINE_REASONS = ['routine', 'damaged', 'defective'] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/**
 * SF-PROBLEM-BIN Phase A — the ONE warehouse-wide Problem Bin quarantine writer.
 * ----------------------------------------------------------------------------
 * Free Scan → scan Problem Bin → scan exact LSU → quarantine → Problem Center.
 * Works without any operational task. Optional adapters (Stow today) add task
 * accounting inside the same transaction; they never write inventory.
 *
 * Source authority: derived ONLY from server-verified unit custody, never
 * from the client and never assumed:
 *   received, unplaced, no Receive custody lineage → WH-{shop}-ROOT
 *   stowed at an active pick bin                   → that bin
 * Everything else (held, discarded, picked, packed, shipped, returned, lost,
 * already quarantined, Receive-custody lineage) is refused before any write.
 *
 * Inventory effect (one transaction): two balanced location_transfer legs.
 * Source on_hand −1 and available −1 (refused when no unreserved unit exists
 * there — reservations are never consumed). Problem Bin on_hand +1 and
 * available in canonical projection form (max(0, on_hand − reserved)), so
 * rebuildInventoryProjection reproduces the row exactly. The unit is never
 * sellable: the problem zone fails pickableLocationCondition (the only
 * reservation/eligibility path, readReleaseCapacity), and the LSU is
 * 'quarantined' (pick readiness needs 'stowed'/'received'). On-hand conserved.
 * No write-off, no channel (Shopify) push — no approved sync contract.
 *
 * Lock order (matches confirmStow): shop hierarchy advisory lock → replay
 * lookup → active Stow tasks of the unit's line (sorted) → adapter task →
 * unit FOR UPDATE → inventory_truth rows (sorted). Caller owns the
 * transaction, tenant GUC and projection GUC.
 */

export const PROBLEM_BIN_QUARANTINE_FLAG = 'PROBLEM_BIN_QUARANTINE_ENABLED';
export function isProblemBinQuarantineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PROBLEM_BIN_QUARANTINE_FLAG] === 'true';
}

export type ProblemBinError = Error & { statusCode: number; errorCode: string };
export function problemBinError(code: string, statusCode = 409, message = code): ProblemBinError {
  return Object.assign(new Error(message), { statusCode, errorCode: code });
}

export const ACTIVE_STOW_STATUSES = ['pending', 'in_progress'] as const;
const ACTIVE_RECOUNT_STATUSES = ['dispatched', 'claimed', 'counting', 'manual_review'];
const NS = '27bf2eb0-6084-45e4-8fab-383cc6ed92cb';
export const rootLocationCode = (shopId: number) => `WH-${shopId}-ROOT`;

export interface QuarantineUnitRow {
  lasyncro_unit_id: string;
  lasyncro_variant_id: string;
  receive_job_line_id: string | null;
  status: string;
  current_location_code: string | null;
  held_placed_at: Date | null;
}

/** Task-specific accounting, run inside the core transaction under its locks. */
export interface ProblemBinQuarantineAdapter {
  kind: 'stow';
  contextId: string;
  /** Locks and validates the context row before the unit is locked. */
  lock(trx: Knex.Transaction): Promise<void>;
  /** Validates the locked unit belongs to this context. Throws to refuse. */
  assertUnit(trx: Knex.Transaction, unit: QuarantineUnitRow): Promise<void>;
  /** Writes context accounting; its return is merged into the result. */
  apply(trx: Knex.Transaction, unit: QuarantineUnitRow, now: Date): Promise<Record<string, unknown>>;
}

export interface ProblemBinQuarantineInput {
  shopId: number;
  actorId: number;
  lasyncroUnitId: string;
  problemBinScan: string;
  deviceEventId: string;
  /** S2 (0232): minimal classification — routine recovery vs damaged/defective. */
  quarantineReason: QuarantineReason;
  adapter?: ProblemBinQuarantineAdapter;
}

export async function quarantineUnitToProblemBin(trx: Knex.Transaction, input: ProblemBinQuarantineInput) {
  if (!isProblemBinQuarantineEnabled()) throw problemBinError('PROBLEM_BIN_QUARANTINE_DISABLED');
  const { shopId, actorId, lasyncroUnitId, problemBinScan, deviceEventId, quarantineReason, adapter } = input;
  if (!(QUARANTINE_REASONS as readonly string[]).includes(quarantineReason)) {
    throw problemBinError('PROBLEM_BIN_QUARANTINE_REASON_REQUIRED', 400);
  }
  const contextKind = adapter?.kind ?? 'free_scan';
  const contextId = adapter?.contextId ?? null;

  await lockStowDestinationHierarchy(trx, shopId);

  // Replay authority first: a same-event retry waits on the shop lock behind
  // the original and then returns its committed result, even if the context
  // (e.g. the Stow task) has since completed.
  const prior = await trx('problem_bin_custody_events').where({ shop_id: shopId, device_event_id: deviceEventId }).first();
  if (prior) {
    if (prior.lasyncro_unit_id !== lasyncroUnitId || prior.problem_bin_scan !== problemBinScan ||
        prior.operator_id !== actorId || prior.context_kind !== contextKind || (prior.stow_task_id ?? null) !== contextId ||
        (prior.quarantine_reason ?? null) !== quarantineReason) {
      throw problemBinError('PROBLEM_BIN_REPLAY_CONFLICT');
    }
    return { ...prior.result, replayed: true };
  }

  const bin = await resolveActiveProblemBin(trx, shopId, problemBinScan);
  await assertStowDestinationEligible(trx, shopId, bin.location_code); // physical leaf + active ancestry

  // Lock every active Stow task of the unit's Receive line BEFORE the unit
  // (confirmStow order), so task association cannot change under us.
  const peek = await trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
    .first('receive_job_line_id');
  const lineTasks = peek?.receive_job_line_id
    ? await trx('stow_tasks').where({ shop_id: shopId, receive_job_line_id: peek.receive_job_line_id })
      .whereIn('status', ACTIVE_STOW_STATUSES as unknown as string[])
      .orderBy('stow_task_id').forUpdate()
      .select('stow_task_id', 'status', 'trigger', 'quantity', 'quantity_placed', 'quantity_excepted')
    : [];
  if (adapter) await adapter.lock(trx);

  const unit: QuarantineUnitRow | undefined = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId }).forUpdate()
    .first('lasyncro_unit_id', 'lasyncro_variant_id', 'receive_job_line_id', 'status', 'current_location_code', 'held_placed_at');
  if (!unit) throw problemBinError('PROBLEM_BIN_UNIT_NOT_FOUND', 404);
  if (unit.receive_job_line_id !== (peek?.receive_job_line_id ?? null)) throw problemBinError('PROBLEM_BIN_UNIT_CHANGED');

  // Receive held custody (0226/0227) owns any unit with that lineage.
  if (unit.held_placed_at !== null) throw problemBinError('PROBLEM_BIN_UNIT_IN_RECEIVE_CUSTODY');
  let source: string;
  if (unit.status === 'quarantined') {
    throw problemBinError('PROBLEM_BIN_UNIT_ALREADY_QUARANTINED');
  } else if (unit.status === 'received') {
    if (unit.current_location_code !== null) throw problemBinError('PROBLEM_BIN_UNIT_INELIGIBLE');
    source = rootLocationCode(shopId);
  } else if (unit.status === 'stowed') {
    if (!unit.current_location_code) throw problemBinError('PROBLEM_BIN_UNIT_INELIGIBLE');
    source = unit.current_location_code;
  } else {
    throw problemBinError('PROBLEM_BIN_UNIT_INELIGIBLE', 409, `${lasyncroUnitId} is ${unit.status} and cannot be quarantined here`);
  }

  // An LSU owned by an unfinished inbound Stow task may only be quarantined
  // through that task's adapter, so task accounting stays exact.
  const owningTask = unit.status === 'received'
    ? lineTasks.find((t: any) => t.trigger === 'inbound_stock' && t.quantity_placed + t.quantity_excepted < t.quantity)
    : undefined;
  if (owningTask && !(adapter?.kind === 'stow' && adapter.contextId === owningTask.stow_task_id)) {
    throw problemBinError('PROBLEM_BIN_UNIT_ON_ACTIVE_STOW', 409, `${lasyncroUnitId} belongs to an active Stow task — quarantine it from Stow`);
  }
  if (adapter) await adapter.assertUnit(trx, unit);

  // The source must be a live, sellable location of this shop.
  const sourceLocation = await trx('warehouse_locations as wl')
    .where({ 'wl.shop_id': shopId, 'wl.location_code': source, 'wl.active': true })
    .whereRaw(pickableLocationCondition(trx)).first('wl.location_code');
  if (!sourceLocation) throw problemBinError('PROBLEM_BIN_SOURCE_INELIGIBLE');
  if (source === bin.location_code) throw problemBinError('PROBLEM_BIN_SOURCE_INELIGIBLE');

  const activeRecount = await trx('inventory_recount_lines as l')
    .join('inventory_recount_tasks as t', 't.recount_task_id', 'l.recount_task_id')
    .where({ 't.shop_id': shopId, 'l.lasyncro_variant_id': unit.lasyncro_variant_id, 'l.location_code': source })
    .whereIn('t.status', ACTIVE_RECOUNT_STATUSES).first('t.recount_task_id');
  if (activeRecount) throw problemBinError('PROBLEM_BIN_SOURCE_UNDER_RECOUNT');

  const activeIncident = await trx('problem_center_tasks')
    .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId }).whereIn('status', ['open', 'investigating'])
    .first('problem_task_id');
  if (activeIncident) throw problemBinError('PROBLEM_BIN_UNIT_HAS_ACTIVE_INCIDENT');

  const variantId = unit.lasyncro_variant_id;
  const now = new Date();
  await trx('inventory_truth').where({ shop_id: shopId, lasyncro_variant_id: variantId })
    .whereIn('location_code', [source, bin.location_code]).orderBy('location_code').forUpdate().select('location_code');
  // Only an UNRESERVED unit may leave: never consume another order's allocation.
  const debit = await trx('inventory_truth')
    .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: source })
    .where('on_hand_quantity', '>=', 1).where('available_quantity', '>=', 1)
    .update({ on_hand_quantity: trx.raw('on_hand_quantity - 1'), available_quantity: trx.raw('available_quantity - 1'),
      updated_at: now, last_evaluated_at: now });
  if (debit !== 1) throw problemBinError('PROBLEM_BIN_SOURCE_STOCK_RESERVED_OR_MISSING');
  // Canonical projection form (rebuildInventoryProjection): available =
  // max(0, on_hand − reserved). Non-pickability is the location rule, not this
  // column — a rebuild must reproduce exactly what is written here.
  await trx('inventory_truth').insert({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: bin.location_code,
    on_hand_quantity: 1, available_quantity: 1, reserved_quantity: 0, committed_quantity: 0, last_evaluated_at: now })
    .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code']).merge({
      on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + 1'),
      available_quantity: trx.raw('GREATEST(0, inventory_truth.on_hand_quantity + 1 - inventory_truth.reserved_quantity)'),
      updated_at: now, last_evaluated_at: now });

  const incidentId = uuidv5(`${shopId}:${deviceEventId}:problem-bin-incident`, NS);
  for (const [leg, location, delta] of [['debit', source, -1], ['credit', bin.location_code, 1]] as const) {
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: uuidv5(`${incidentId}:${leg}:movement`, NS),
      device_event_id: uuidv5(`${incidentId}:${leg}:device`, NS), shop_id: shopId, lasyncro_variant_id: variantId,
      movement_type: 'location_transfer', quantity_delta: delta, location_code: location,
      reference_type: 'problem_bin_quarantine', reference_id: incidentId, platform: 'wms',
      triggered_by: contextKind === 'stow' ? 'stow' : 'problem_bin', operator_id: actorId, occurred_at: now });
  }

  await trx('problem_center_tasks').insert({ problem_task_id: incidentId, shop_id: shopId, source: 'warehouse', status: 'open',
    source_exception_id: contextId, lasyncro_unit_id: lasyncroUnitId, lasyncro_variant_id: variantId,
    quantity: 1, exception_type: 'quarantined_unit', problem_bin_location: bin.location_code });

  const contextResult = adapter ? await adapter.apply(trx, unit, now) : {};
  const result = { problem_task_id: incidentId, lasyncro_unit_id: lasyncroUnitId, problem_bin_location: bin.location_code,
    source_location: source, source_status: unit.status, context: contextKind, quarantine_reason: quarantineReason, ...contextResult };
  // Custody evidence precedes the unit transition: the 0231 guard requires it.
  await trx('problem_bin_custody_events').insert({ shop_id: shopId, device_event_id: deviceEventId,
    lasyncro_unit_id: lasyncroUnitId, problem_bin_scan: problemBinScan, problem_bin_location: bin.location_code,
    source_location: source, source_status: unit.status, context_kind: contextKind, stow_task_id: contextId,
    operator_id: actorId, problem_task_id: incidentId, quarantine_reason: quarantineReason, result });
  await trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId }).update({
    status: 'quarantined', current_location_code: bin.location_code,
    quarantined_from_location: source, quarantined_from_status: unit.status, updated_at: now });

  await writeAuditLog(trx, { shopId, operatorId: actorId, actionType: 'problem_bin_quarantine',
    entityType: 'inventory_unit', entityId: lasyncroUnitId, metadata: result });
  return { ...result, replayed: false };
}
