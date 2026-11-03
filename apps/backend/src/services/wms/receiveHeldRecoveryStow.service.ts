import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { RESOLVABLE_PROBLEM_STATUSES } from './problemCenterResolutionPolicy.js';
import { RECOVERABLE_HELD_EXCEPTION_TYPES } from './receiveHeldResolution.service.js';
import { recoveryDestinationSyncRefusal } from './receiveRecoverySyncEligibility.service.js';

/**
 * S8-C5 / S4-5 I3 — recovery Stow of a held Receive unit
 * (contract SF-RECEIVE-S8C5-S4-CONTRACT-026 + Addenda A1–A3; 0227 certified in I1).
 *
 * Called by confirmStow with the receive_recovery stow_tasks row already locked
 * FOR UPDATE (A1 D.T5 step 1). This service then locks inventory_units →
 * problem_center_tasks, revalidates everything and, in the caller's
 * transaction, writes (order fixed by the 0227 guards):
 *
 *   recovered outcome event → one +1 inbound_purchase at the destination
 *   (A2/A3) → inventory_truth +1 → unit 'stowed' at the destination →
 *   Stow 'completed' → Problem Center task 'resolved'.
 *
 * No source debit: a held unit was never in truth (026 I1). The movement is
 * told apart from a supplier receipt by reference_type 'inventory_unit' and
 * triggered_by 'receive_recovery' (a receipt is reference_type 'receive_job',
 * triggered_by 'receive_job'). Shopify is not synchronised here (I4).
 */

const RECOVERY_NAMESPACE = '3c7e9a1f-5b2d-4e8c-9f60-2a4d8b1e7c35';

/** Staging and exception zones never receive recovered stock. NULL = legacy storage bin. */
const RECOVERY_DESTINATION_ZONES = ['pick', 'storage'] as const;

export class ReceiveRecoveryStowError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly reason?: string
  ) {
    super(reason ? `${code}: ${reason}` : code);
  }
}

const notEligible = (reason: string) => new ReceiveRecoveryStowError('RECEIVE_RECOVERY_NOT_ELIGIBLE', 409, reason);

/**
 * Deterministic recovery identity, uuidv5(stowTaskId:lsu) (026 I3 / A2.7). Its
 * own namespace and name shape, so it can never equal the Receive-close receipt
 * identity (receiveJobId:variant:inbound_purchase / receiveJobId:variant:device).
 */
export function recoveryCreditIdentity(stowTaskId: string, lasyncroUnitId: string) {
  return {
    movementId: uuidv5(`${stowTaskId}:${lasyncroUnitId}:receive_recovery:credit`, RECOVERY_NAMESPACE),
    deviceEventId: uuidv5(`${stowTaskId}:${lasyncroUnitId}`, RECOVERY_NAMESPACE),
  };
}

/**
 * Ratified destination: an active storage bin that is not a designated problem
 * bin (problem zone or the shop's configured problem bin) and not the unit's
 * custody bin.
 */
export async function assertRecoveryDestination(
  trx: Knex.Transaction,
  shopId: number,
  destination: string,
  custodyLocation: string | null
): Promise<void> {
  const location = await trx('warehouse_locations')
    .where({ shop_id: shopId, location_code: destination, active: true, type: 'bin' })
    .where((zone) => zone.whereNull('zone_type').orWhereIn('zone_type', RECOVERY_DESTINATION_ZONES as unknown as string[]))
    .first('location_code');
  if (!location) throw new ReceiveRecoveryStowError('RECEIVE_RECOVERY_DESTINATION_INVALID', 409, 'not_an_active_storage_bin');

  const settings = await trx('shop_wms_settings').where({ shop_id: shopId }).first('problem_bin_location');
  if (settings?.problem_bin_location && settings.problem_bin_location === destination) {
    throw new ReceiveRecoveryStowError('RECEIVE_RECOVERY_DESTINATION_INVALID', 409, 'designated_problem_bin');
  }
  if (!custodyLocation || custodyLocation === destination) {
    throw new ReceiveRecoveryStowError('RECEIVE_RECOVERY_DESTINATION_INVALID', 409, 'custody_bin');
  }

  // SAFETY-015: a recovered unit must land where its credit can be pushed to
  // Shopify (applies to every shop). Recoverable: the operator picks another bin.
  const syncRefusal = await recoveryDestinationSyncRefusal(trx, shopId, destination);
  if (syncRefusal) throw new ReceiveRecoveryStowError('RECEIVE_RECOVERY_DESTINATION_INVALID', 409, syncRefusal);
}

/** Destination check for a pre-claim or mid-task location assignment (Stow row already locked). */
export async function assertRecoveryStowDestination(
  trx: Knex.Transaction,
  shopId: number,
  sourceTaskId: string,
  destination: string
): Promise<void> {
  const task = await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: sourceTaskId, source: 'receive' })
    .first('problem_bin_location');
  await assertRecoveryDestination(trx, shopId, destination, task?.problem_bin_location ?? null);
}

export interface LockedRecoveryStow {
  stow_task_id: string;
  lasyncro_variant_id: string;
  quantity: number;
  location_code: string;
  source_task_id: string;
}

export interface ConfirmRecoveryStowInput {
  shopId: number;
  claimedBy: number;
  task: LockedRecoveryStow;
  lasyncroUnitId?: string;
  quantityPlaced?: number;
}

export async function confirmReceiveRecoveryStow(
  trx: Knex.Transaction,
  input: ConfirmRecoveryStowInput
): Promise<{ isFullyPlaced: true; quantityPlaced: 1; quantityTotal: 1; placedNow: 1; locationCode: string }> {
  const { shopId, claimedBy, task } = input;
  const stowTaskId = task.stow_task_id;
  const destination = task.location_code;

  if (task.quantity !== 1 || (input.quantityPlaced !== undefined && input.quantityPlaced !== 1)) {
    throw notEligible('single_unit_required');
  }
  if (!input.lasyncroUnitId) throw new ReceiveRecoveryStowError('RECOVERY_LSU_REQUIRED', 409);

  // Immutable identity (0224 unique, 0226 immutable): read without a lock.
  const identity = await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: task.source_task_id, source: 'receive' })
    .whereNotNull('lasyncro_unit_id')
    .first('lasyncro_unit_id');
  if (!identity) throw notEligible('source_task_not_found');
  const lsu: string = identity.lasyncro_unit_id;
  if (input.lasyncroUnitId !== lsu) throw new ReceiveRecoveryStowError('RECOVERY_LSU_MISMATCH', 409);

  // ── A1 D.T5: (Stow held by caller) → unit → task ─────────────────────────
  const unit = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lsu })
    .forUpdate()
    .first('id', 'status', 'held_placed_at', 'current_location_code', 'receive_job_line_id', 'lasyncro_variant_id');
  const problem = await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: task.source_task_id })
    .forUpdate()
    .first('status', 'source', 'lasyncro_unit_id', 'lasyncro_variant_id', 'exception_type', 'source_exception_id', 'problem_bin_location');

  // ── Revalidate under all three locks ────────────────────────────────────
  if (!problem || problem.source !== 'receive' || problem.lasyncro_unit_id !== lsu) {
    throw notEligible('source_task_not_found');
  }
  if (!(RESOLVABLE_PROBLEM_STATUSES as readonly string[]).includes(problem.status)) {
    throw new ReceiveRecoveryStowError('TASK_ALREADY_RESOLVED', 409);
  }
  const outcome = await trx('receive_held_recovery_events')
    .where({ shop_id: shopId, problem_task_id: task.source_task_id })
    .first('outcome');
  if (outcome) throw new ReceiveRecoveryStowError('TASK_ALREADY_RESOLVED', 409);

  if (!unit) throw notEligible('unit_not_found');
  if (unit.status !== 'held') throw notEligible('unit_not_held');
  if (!unit.held_placed_at || !unit.current_location_code) throw notEligible('unit_not_in_custody');
  if (unit.lasyncro_variant_id !== task.lasyncro_variant_id || unit.lasyncro_variant_id !== problem.lasyncro_variant_id) {
    throw notEligible('unit_task_mismatch');
  }
  if (!(RECOVERABLE_HELD_EXCEPTION_TYPES as readonly string[]).includes(problem.exception_type)) {
    throw notEligible('classification_not_recoverable');
  }

  const custody = await trx('receive_held_custody_events')
    .where({ shop_id: shopId, lasyncro_unit_id: lsu, problem_task_id: task.source_task_id })
    .first('location_code');
  if (
    !custody ||
    custody.location_code !== unit.current_location_code ||
    problem.problem_bin_location !== custody.location_code
  ) {
    throw notEligible('custody_not_verified');
  }

  const evidence = await trx('receive_exceptions')
    .where({ shop_id: shopId, receive_exception_id: problem.source_exception_id })
    .first('disposition', 'exception_type', 'receive_job_line_id');
  if (
    !evidence ||
    evidence.disposition !== 'recoverable_held' ||
    !(RECOVERABLE_HELD_EXCEPTION_TYPES as readonly string[]).includes(evidence.exception_type) ||
    evidence.receive_job_line_id !== unit.receive_job_line_id
  ) {
    throw notEligible('evidence_not_recoverable');
  }

  const job = await trx('receive_job_lines as l')
    .join('receive_jobs as j', function joinJob() {
      this.on('j.receive_job_id', '=', 'l.receive_job_id').andOn('j.shop_id', '=', 'l.shop_id');
    })
    .where({ 'l.shop_id': shopId, 'l.receive_job_line_id': unit.receive_job_line_id })
    .first('j.status');
  if (job?.status !== 'closed') throw notEligible('receive_not_closed');

  await assertRecoveryDestination(trx, shopId, destination, custody.location_code);

  // ── Apply (one transaction; any throw rolls every write back) ───────────
  const now = new Date();
  const { movementId, deviceEventId } = recoveryCreditIdentity(stowTaskId, lsu);

  await trx('receive_held_recovery_events').insert({
    shop_id: shopId,
    device_event_id: deviceEventId,
    lasyncro_unit_id: lsu,
    problem_task_id: task.source_task_id,
    outcome: 'recovered',
    stow_task_id: stowTaskId,
    location_code: destination,
    recorded_by: claimedBy,
  });

  const credited = await trx('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: movementId,
      lasyncro_variant_id: task.lasyncro_variant_id,
      shop_id: shopId,
      movement_type: 'inbound_purchase',
      quantity_delta: 1,
      location_code: destination,
      reference_type: 'inventory_unit',
      reference_id: unit.id,
      platform: 'wms',
      occurred_at: now,
      device_event_id: deviceEventId,
      operator_id: claimedBy,
      triggered_by: 'receive_recovery',
    })
    .onConflict(['device_event_id'])
    .ignore()
    .returning('lasyncro_inventory_movement_id');
  // GH-1243 pattern: an ignored insert means this credit already exists.
  if (credited.length !== 1) {
    throw new ReceiveRecoveryStowError('RECEIVE_RECOVERY_CREDIT_DUPLICATE', 409, 'credit_already_recorded');
  }

  await trx('inventory_truth')
    .insert({
      shop_id: shopId,
      lasyncro_variant_id: task.lasyncro_variant_id,
      location_code: destination,
      on_hand_quantity: 1,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 1,
      last_evaluated_at: now,
    })
    .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
    .merge({
      on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + 1'),
      available_quantity: trx.raw('inventory_truth.available_quantity + 1'),
      last_evaluated_at: now,
      updated_at: now,
    });

  await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lsu })
    .update({ status: 'stowed', current_location_code: destination, updated_at: now });

  await trx('stow_tasks')
    .where({ shop_id: shopId, stow_task_id: stowTaskId })
    .update({
      quantity_placed: 1,
      status: 'completed',
      completed_at: now,
      inventory_movement_id: movementId,
      updated_at: now,
    });

  await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: task.source_task_id })
    .update({
      status: 'resolved',
      resolution_action: 're_stow',
      resolved_by: claimedBy,
      resolved_at: now,
      updated_at: now,
    });

  await writeAuditLog(trx, {
    shopId,
    operatorId: claimedBy,
    actionType: 'stow_confirm',
    entityType: 'stow_task',
    entityId: stowTaskId,
    metadata: {
      trigger: 'receive_recovery',
      location_code: destination,
      quantity: 1,
      lasyncro_variant_id: task.lasyncro_variant_id,
      inventory_movement_id: movementId,
      stowed_unit_ids: [lsu],
      problem_task_id: task.source_task_id,
    },
  });

  console.info('[RECEIVE_HELD_RECOVERED]', {
    stowTaskId,
    problem_task_id: task.source_task_id,
    lasyncro_unit_id: lsu,
    location_code: destination,
    shopId,
  });

  return { isFullyPlaced: true, quantityPlaced: 1, quantityTotal: 1, placedNow: 1, locationCode: destination };
}
