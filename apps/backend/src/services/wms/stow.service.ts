// apps/backend/src/services/wms/stow.service.ts
import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { writeAuditLog } from '../audit/operatorAudit.service.js';

/**
 * STOW SERVICE (WM-05)
 * ---------------------
 * Handles stow task lifecycle:
 * - Create stow tasks (from order cancellation or inbound stock)
 * - Claim a stow task (operator takes ownership)
 * - Confirm stow completion (writes location_transfer movements)
 *
 * On stow confirmation:
 * 1. Validates task is claimed by operator
 * 2. Writes TWO location_transfer movements to inventory_movements:
 *    a. Debit  — negative delta at source location (WH-{shopId}-ROOT or unit's current_location_code)
 *    b. Credit — positive delta at destination bin (task.location_code)
 * 3. Links credit movement ID → stow_tasks.inventory_movement_id
 * 4. Updates inventory_truth: decrement source, upsert destination
 * 5. Updates inventory_units → status=stowed, current_location_code (LSU-path only)
 * 6. Transitions stow_task → completed
 *
 * Idempotency:
 * - device_event_id = uuidv5(stow_task_id + ':device:debit|credit', STOW_NAMESPACE) — deterministic
 * - onConflict ignore prevents double-write on retry
 *
 * Caller must:
 * - Operate within a transaction
 * - Have SET LOCAL "app.current_tenant" active
 * - Have SET LOCAL "synchroflow.projection" = 'true' active
 *   (required by inventory_movements immutability trigger)
 */

const STOW_NAMESPACE = 'b2e4f6a8-1c3d-4e5f-8a9b-0c1d2e3f4a5b'; // fixed constant

export interface CreateStowTaskInput {
  shopId: number;
  lasyncroVariantId: string;
  quantity: number;
  locationCode?: string;        // nullable — assigned after WM-36 suggestion
  trigger: 'order_cancelled_mid_pick' | 'inbound_stock' | 'return_restock' | 'problem_center';
  pickBatchId?: string;
  lasyncroOrderId?: string;
  poId?: string;                // populated when trigger = inbound_stock (FEAT-004)
}

export interface StowConfirmInput {
  stowTaskId: string;
  shopId: number;
  claimedBy: number;
  quantityPlaced?: number;   // partial stow support
  lasyncroUnitId?: string;   // WEB-STOW-UNIT-01: LSU- unit ID resolved at scan time; optional for legacy fallback path
}

export async function createStowTask(
  trx: Knex.Transaction,
  input: CreateStowTaskInput
): Promise<string> {
  const {
    shopId,
    lasyncroVariantId,
    quantity,
    locationCode,
    trigger,
    pickBatchId,
    lasyncroOrderId,
    poId,
  } = input;

  const result = await trx('stow_tasks')
    .insert({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      quantity,
      location_code: locationCode ?? null,
      po_id: poId ?? null,
      status: 'pending',
      trigger,
      pick_batch_id: pickBatchId ?? null,
      lasyncro_order_id: lasyncroOrderId ?? null,
    })
    .returning('stow_task_id');

  const stowTaskId = result[0]?.stow_task_id ?? result[0];

  console.info('[STOW_TASK_CREATED]', {
    stowTaskId,
    shopId,
    lasyncroVariantId,
    quantity,
    locationCode,
    trigger,
  });

  return stowTaskId;
}

export async function claimStowTask(
  trx: Knex.Transaction,
  stowTaskId: string,
  shopId: number,
  userId: number
): Promise<void> {
  const task = await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId, shop_id: shopId })
    .select('status', 'claimed_by', 'location_code')
    .first();

  if (!task) throw new Error(`[STOW_CLAIM] Task not found: ${stowTaskId}`);
  // Allow operator to re-claim their own in-progress task (e.g. after navigating back)
  if (task.status === 'in_progress' && task.claimed_by === userId) return;
  if (task.status !== 'pending') throw new Error(`[STOW_CLAIM] Task not claimable: ${task.status}`);
  if (!task.location_code) throw new Error(`[STOW_CLAIM] Cannot claim stow task without assigned location: ${stowTaskId}`);
  if (task.claimed_by !== null) throw new Error('[STOW_CLAIM] Task already claimed');

  const now = new Date();

  await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId })
    .update({
      status: 'in_progress',
      claimed_by: userId,
      claimed_at: now,
      updated_at: now,
    });

  console.info('[STOW_TASK_CLAIMED]', { stowTaskId, userId, shopId });
  await writeAuditLog(trx, {
    shopId,
    operatorId: userId,
    actionType: 'stow_claim',
    entityType: 'stow_task',
    entityId: stowTaskId,
    metadata: { location_code: task.location_code },
  });
}

export async function confirmStow(
  trx: Knex.Transaction,
  input: StowConfirmInput
): Promise<void> {
  const { stowTaskId, shopId, claimedBy, quantityPlaced, lasyncroUnitId } = input;

  // 1. Validate task
  const task = await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId, shop_id: shopId })
    .select('status', 'claimed_by', 'lasyncro_variant_id', 'quantity', 'location_code', 'trigger')
    .first();

  if (!task) throw new Error(`[STOW_CONFIRM] Task not found: ${stowTaskId}`);
  if (task.status !== 'in_progress') throw new Error(`[STOW_CONFIRM] Task not in progress: ${task.status}`);
  if (!task.location_code) throw new Error(`[STOW_CONFIRM] Cannot confirm stow: location_code not assigned to task ${stowTaskId}`);
  if (task.claimed_by !== claimedBy) throw new Error('[STOW_CONFIRM] Task owned by different operator');

  const completedAt = new Date();
  const qty = quantityPlaced ?? task.quantity; // support partial stow

  // WEB-STOW-UNIT-01: resolve source location from unit's current position when LSU- scanned;
  // fall back to shop root for legacy (non-unit) stow path.
  let sourceLocation = `WH-${shopId}-ROOT`;
  if (lasyncroUnitId) {
    const unitRow = await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
      .select('current_location_code')
      .first();
    sourceLocation = unitRow?.current_location_code ?? `WH-${shopId}-ROOT`;
  }

  // 2a. Decrement source location in inventory_truth
  await trx('inventory_truth')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: task.lasyncro_variant_id,
      location_code: sourceLocation,
    })
    .update({
      on_hand_quantity: trx.raw('GREATEST(0, on_hand_quantity - ?)', [qty]),
      available_quantity: trx.raw('GREATEST(0, available_quantity - ?)', [qty]),
      sellable_quantity: trx.raw('GREATEST(0, sellable_quantity - ?)', [qty]),
      last_evaluated_at: completedAt,
      updated_at: completedAt,
    });

  // 2b. Upsert destination bin in inventory_truth
  await trx('inventory_truth')
    .insert({
      shop_id: shopId,
      lasyncro_variant_id: task.lasyncro_variant_id,
      location_code: task.location_code,
      on_hand_quantity: qty,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: qty,
      sellable_quantity: qty,
      last_evaluated_at: completedAt,
    })
    .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
    .merge({
      on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + ?', [qty]),
      available_quantity: trx.raw('inventory_truth.available_quantity + ?', [qty]),
      sellable_quantity: trx.raw('inventory_truth.sellable_quantity + ?', [qty]),
      last_evaluated_at: completedAt,
      updated_at: completedAt,
    });

  console.info('[STOW_LOCATION_TRANSFER]', {
    lasyncroVariantId: task.lasyncro_variant_id,
    quantity: qty,
    from: sourceLocation,
    to: task.location_code,
    shopId,
  });

  // 3. Write location_transfer movements — one debit at source, one credit at destination.
  //    Both are deterministic via uuidv5 so retries are idempotent.
  //    Caller must have SET LOCAL "synchroflow.projection" = 'true' active.
  const debitMovementId = uuidv5(`${stowTaskId}:location_transfer:debit`, STOW_NAMESPACE);
  const debitDeviceEventId = uuidv5(`${stowTaskId}:device:debit`, STOW_NAMESPACE);
  const creditMovementId = uuidv5(`${stowTaskId}:location_transfer:credit`, STOW_NAMESPACE);
  const creditDeviceEventId = uuidv5(`${stowTaskId}:device:credit`, STOW_NAMESPACE);

  // 3a. Debit — stock leaves source location
  await trx('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: debitMovementId,
      lasyncro_variant_id: task.lasyncro_variant_id,
      shop_id: shopId,
      movement_type: 'location_transfer',
      quantity_delta: -qty,
      location_code: sourceLocation,
      reference_type: 'stow_task',
      reference_id: stowTaskId,
      platform: 'wms',
      occurred_at: completedAt,
      device_event_id: debitDeviceEventId,
      operator_id: claimedBy,
      triggered_by: 'stow',
    })
    .onConflict(['device_event_id'])
    .ignore();

  // 3b. Credit — stock arrives at destination bin
  //     return_restock trigger → refund_return movement so restock rate
  //     query in returnsIntelligence.service.ts can count it correctly.
  await trx('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: creditMovementId,
      lasyncro_variant_id: task.lasyncro_variant_id,
      shop_id: shopId,
      movement_type: task.trigger === 'return_restock' ? 'refund_return' : 'location_transfer',
      quantity_delta: qty,
      location_code: task.location_code,
      reference_type: 'stow_task',
      reference_id: stowTaskId,
      platform: 'wms',
      occurred_at: completedAt,
      device_event_id: creditDeviceEventId,
      operator_id: claimedBy,
      triggered_by: 'stow',
    })
    .onConflict(['device_event_id'])
    .ignore();

  // 3c. Link credit movement back to stow task for traceability
  await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId })
    .update({ inventory_movement_id: creditMovementId });

  console.info('[STOW_MOVEMENTS_WRITTEN]', {
    stowTaskId,
    debitMovementId,
    creditMovementId,
    from: sourceLocation,
    to: task.location_code,
    qty,
  });

  // 4. Bulk-update inventory_units → stowed (WEB-STOW-UNIT-01)
  // LSU- path only. Scanned unit is updated first (guaranteed inclusion),
  // then remaining qty-1 units from same variant+job line are updated in
  // one pass. This supports box-stow: operator scans one LSU- from a box
  // of identical units and confirms qty — all matching received units updated.
  if (lasyncroUnitId) {
    // 4a. Resolve receive_job_line_id from scanned unit
    const scannedUnit = await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
      .select('receive_job_line_id')
      .first();

    if (scannedUnit?.receive_job_line_id) {
      // 4b. Always update the scanned unit first
      await trx('inventory_units')
        .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
        .update({
          status: 'stowed',
          current_location_code: task.location_code,
          updated_at: completedAt,
        });

      // 4c. Bulk-update remaining qty-1 units from same job line
      const remaining = qty - 1;
      if (remaining > 0) {
        const siblingIds = await trx('inventory_units')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: task.lasyncro_variant_id,
            receive_job_line_id: scannedUnit.receive_job_line_id,
            status: 'received',
          })
          .whereNot({ lasyncro_unit_id: lasyncroUnitId })
          .limit(remaining)
          .pluck('lasyncro_unit_id');

    if (siblingIds.length > 0) {
          await trx('inventory_units')
            .whereIn('lasyncro_unit_id', siblingIds)
            .andWhere({ shop_id: shopId })
            .update({
              status: 'stowed',
              current_location_code: task.location_code,
              updated_at: completedAt,
            });
        }
      }
    }
  } else {
    // 4e. No LSU scanned (web task-confirm path) — resolve units from the task itself.
    // Stow the variant's oldest `received` units (FIFO), limited to qty. This closes the
    // gap where task-confirm completed the move but left inventory_units at 'received'.
    const unitIds = await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_variant_id: task.lasyncro_variant_id, status: 'received' })
      .orderBy('received_at', 'asc')
      .limit(qty)
      .pluck('lasyncro_unit_id');

    if (unitIds.length > 0) {
      await trx('inventory_units')
        .whereIn('lasyncro_unit_id', unitIds)
        .andWhere({ shop_id: shopId })
        .update({
          status: 'stowed',
          current_location_code: task.location_code,
          updated_at: completedAt,
        });
    }
  }

  {
    // 4d. Soft capacity check — count all stowed units at this location.
    // If over max_capacity, create a Problem Center task for bin audit.
    const location = await trx('warehouse_locations')
      .where({ shop_id: shopId, location_code: task.location_code })
      .select('max_capacity')
      .first();

    if (location?.max_capacity != null) {
      const stowedCount = await trx('inventory_units')
        .where({
          shop_id: shopId,
          current_location_code: task.location_code,
          status: 'stowed',
        })
        .count('* as count')
        .first();

      const currentCount = Number(stowedCount?.count ?? 0);

      if (currentCount > location.max_capacity) {
        const seqResult = await trx.raw<{ rows: { prob_label_sequence: number; problem_bin_location: string }[] }>(
          `UPDATE shop_wms_settings
           SET prob_label_sequence = prob_label_sequence + 1, updated_at = NOW()
           WHERE shop_id = ?
           RETURNING prob_label_sequence, problem_bin_location`,
          [shopId]
        );
        const seqRow = seqResult.rows[0];
        const probLabel = `PROB-${shopId}-${String(seqRow.prob_label_sequence).padStart(4, '0')}`;

        await trx('problem_center_tasks').insert({
          shop_id: shopId,
          status: 'open',
          source: 'stow',
          source_exception_id: stowTaskId,
          lasyncro_variant_id: task.lasyncro_variant_id,
          quantity: currentCount,
          exception_type: 'bin_over_capacity',
          problem_bin_location: task.location_code,
          notes: `${probLabel} — Bin ${task.location_code} has ${currentCount} units, max is ${location.max_capacity}. Audit required.`,
        });

        console.warn('[STOW_BIN_OVER_CAPACITY]', {
          shopId,
          locationCode: task.location_code,
          currentCount,
          maxCapacity: location.max_capacity,
          probLabel,
        });
      }
    }
  }

  // 5. Complete stow task
  await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId })
    .update({
      status: 'completed',
      completed_at: completedAt,
      updated_at: completedAt,
    });

  console.info('[STOW_CONFIRMED]', {
    stowTaskId,
    shopId,
    claimedBy,
  });

  await writeAuditLog(trx, {
    shopId,
    operatorId: claimedBy,
    actionType: 'stow_confirm',
    entityType: 'stow_task',
    entityId: stowTaskId,
    metadata: {
      location_code: task.location_code,
      quantity: qty,
      quantity_remaining: task.quantity - qty,
      lasyncro_variant_id: task.lasyncro_variant_id,
      inventory_movement_id: creditMovementId,
    },
  });
}