// apps/backend/src/services/wms/stow.service.ts
import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { enqueueShopSnapshotJob } from '../shop-snapshot/enqueueShopSnapshotJob.js';

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
 * Idempotency (STOW-MOVEMENT-ID-01):
 * - device_event_id = uuidv5(stow_task_id + ':' + unit_id + ':device:debit|credit')
 * - one debit/credit movement pair PER PHYSICAL UNIT, quantity_delta ±1
 * - reference_type='inventory_unit', reference_id=lasyncro_unit_id — required by
 *   inventory_movements_shop_ref_unique, and matches pickScan's granularity
 * - onConflict ignore prevents double-write on retry of the same unit
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
): Promise<{
    isFullyPlaced: boolean;
    quantityPlaced: number;
    quantityTotal: number;
    placedNow: number;
  }> {
  const { stowTaskId, shopId, claimedBy, quantityPlaced, lasyncroUnitId } = input;

  // 1. Validate task
  const task = await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId, shop_id: shopId })
    .select(
      'status',
      'claimed_by',
      'lasyncro_variant_id',
      'quantity',
      'location_code',
      'trigger',
      'source_task_id'
    )
    .first();

  if (!task) throw new Error(`[STOW_CONFIRM] Task not found: ${stowTaskId}`);
  if (task.status !== 'in_progress') throw new Error(`[STOW_CONFIRM] Task not in progress: ${task.status}`);
  if (!task.location_code) throw new Error(`[STOW_CONFIRM] Cannot confirm stow: location_code not assigned to task ${stowTaskId}`);
  if (task.claimed_by !== claimedBy) throw new Error('[STOW_CONFIRM] Task owned by different operator');

    const completedAt = new Date();
    const qty = quantityPlaced ?? task.quantity; // support partial stow
    const isInboundStock = task.trigger === 'inbound_stock';

    if (isInboundStock) {
      if (!lasyncroUnitId) {
        throw new Error('[STOW_CONFIRM] INBOUND_LSU_REQUIRED');
      }

      if (qty !== 1) {
        throw new Error('[STOW_CONFIRM] INBOUND_SINGLE_UNIT_REQUIRED');
      }

      const inboundUnit = await trx('inventory_units')
        .where({
          shop_id: shopId,
          lasyncro_unit_id: lasyncroUnitId,
          lasyncro_variant_id: task.lasyncro_variant_id,
          status: 'received',
        })
        .whereNull('current_location_code')
        .forUpdate()
        .select('lasyncro_unit_id')
        .first();

      if (!inboundUnit) {
        throw new Error('[STOW_CONFIRM] INBOUND_LSU_MISMATCH');
      }
    }

    // INV-BLOCK-04 / INV-BLOCK-10b:
    // - return_restock is an inventory credit because returned stock has no
    //   existing warehouse source row before stow.
    // - order_cancelled_mid_pick is also a credit: the pick sale already removed
    //   the physical unit from inventory_truth, so PROBLEM is operational staging,
    //   not an inventory-bearing source that can be debited.
    // - all other current stow paths are transfers and must conserve stock.
    const isReturnRestockCredit = task.trigger === 'return_restock';
    const isCancelledPickRecovery =
      task.trigger === 'order_cancelled_mid_pick';
    const isInventoryCredit =
      isReturnRestockCredit || isCancelledPickRecovery;

    let sourceLocation: string | null = isInventoryCredit
      ? null
      : `WH-${shopId}-ROOT`;

    if (task.trigger === 'problem_center') {
      const sourceTask = await trx('problem_center_tasks')
        .where({
          problem_task_id: task.source_task_id,
          shop_id: shopId,
        })
        .select('problem_bin_location')
        .first();

      if (!sourceTask?.problem_bin_location) {
        throw new Error(`[STOW_CONFIRM] Problem-center source location missing: ${stowTaskId}`);
      }

      sourceLocation = sourceTask.problem_bin_location;

      if (sourceLocation === task.location_code) {
        throw new Error('[STOW_CONFIRM] Re-stow source and destination must differ');
      }

      const destination = await trx('warehouse_locations')
        .where({
          shop_id: shopId,
          location_code: task.location_code,
          active: true,
          type: 'bin',
        })
        .first('location_code');

      if (!destination) {
        throw new Error('[STOW_CONFIRM] Re-stow destination is not an active bin');
      }
    } else if (isCancelledPickRecovery) {
      if (!lasyncroUnitId) {
        throw new Error(
          '[STOW_CONFIRM] Cancelled-pick recovery requires an LSU scan'
        );
      }

      const sourceTask = await trx('problem_center_tasks')
        .where({
          problem_task_id: task.source_task_id,
          shop_id: shopId,
        })
        .select('problem_bin_location')
        .first();

      if (!sourceTask?.problem_bin_location) {
        throw new Error(
          `[STOW_CONFIRM] Problem-center source location missing: ${stowTaskId}`
        );
      }

      if (sourceTask.problem_bin_location === task.location_code) {
        throw new Error(
          '[STOW_CONFIRM] Re-stow source and destination must differ'
        );
      }

      const destination = await trx('warehouse_locations')
        .where({
          shop_id: shopId,
          location_code: task.location_code,
          active: true,
          type: 'bin',
        })
        .first('location_code');

      if (!destination) {
        throw new Error(
          '[STOW_CONFIRM] Re-stow destination is not an active bin'
        );
      }

      const pickedUnit = await trx('inventory_units')
        .where({
          shop_id: shopId,
          lasyncro_unit_id: lasyncroUnitId,
          lasyncro_variant_id: task.lasyncro_variant_id,
          status: 'picked',
        })
        .whereNull('current_location_code')
        .forUpdate()
        .select('lasyncro_unit_id')
        .first();

      if (!pickedUnit) {
        throw new Error(
          `[STOW_CONFIRM] Cancelled-pick recovery LSU mismatch: ${lasyncroUnitId}`
        );
      }
    } else if (!isInboundStock && !isInventoryCredit && lasyncroUnitId) {
      const unitRow = await trx('inventory_units')
        .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
        .select('current_location_code', 'status')
        .first();

      if (!unitRow) {
        throw new Error(
          `[STOW_CONFIRM] Source location missing for scanned unit ${lasyncroUnitId}`
        );
      }

      /**
       * STOW-LSU-01 (2026-08-11)
       * -----------------------------------------------------------
       * current_location_code is written BY stow confirm and nulled
       * by pick ("unit left the shelf", pickScan.service.ts:518).
       * A unit at status='received' has therefore never had one — its
       * stock was credited to WH-{shopId}-ROOT by closeReceiveJob and
       * has not moved. Requiring the column here made the first stow
       * of any received unit impossible, and since the operator UI
       * always scans an LSU, the entire inbound stow path was
       * unreachable — only the no-LSU web fallback worked.
       * NULL is not missing data; it is "not on a shelf". Fall back to
       * ROOT for received units, matching branch 4e's FIFO handling of
       * the same case. Still throw for a unit that is genuinely
       * unlocatable (e.g. picked, mid-flight, owned by no location).
       */
      if (unitRow.current_location_code) {
        sourceLocation = unitRow.current_location_code;
      } else if (unitRow.status === 'received') {
        sourceLocation = `WH-${shopId}-ROOT`;
      } else {
        throw new Error(
          `[STOW_CONFIRM] Source location missing for scanned unit ${lasyncroUnitId}`
        );
      }
    }

    // Transfer stows must debit the complete quantity atomically.
    // The guarded UPDATE prevents two concurrent confirmations from both
    // consuming the same source stock and removes the old GREATEST(0, ...)
    // under-debit behaviour.
    if (!isInventoryCredit) {
      if (!sourceLocation) {
        throw new Error(`[STOW_CONFIRM] Source location missing for transfer ${stowTaskId}`);
      }

      const sourceUpdated = await trx('inventory_truth')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: task.lasyncro_variant_id,
          location_code: sourceLocation,
        })
        .where('on_hand_quantity', '>=', qty)
        .where('available_quantity', '>=', qty)
        .update({
          on_hand_quantity: trx.raw('on_hand_quantity - ?', [qty]),
          available_quantity: trx.raw('available_quantity - ?', [qty]),
          last_evaluated_at: completedAt,
          updated_at: completedAt,
        });

      if (sourceUpdated !== 1) {
        throw new Error(
          `[STOW_CONFIRM] Insufficient source stock at ${sourceLocation}`
        );
      }
    }
    
  await trx('inventory_truth')
    .insert({
      shop_id: shopId,
      lasyncro_variant_id: task.lasyncro_variant_id,
      location_code: task.location_code,
      on_hand_quantity: qty,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: qty,
      last_evaluated_at: completedAt,
    })
    .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
    .merge({
      on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + ?', [qty]),
      available_quantity: trx.raw('inventory_truth.available_quantity + ?', [qty]),
      last_evaluated_at: completedAt,
      updated_at: completedAt,
    });
  
    console.info(
    isInventoryCredit ? '[STOW_INVENTORY_CREDIT]' : '[STOW_LOCATION_TRANSFER]',
    {
      lasyncroVariantId: task.lasyncro_variant_id,
      quantity: qty,
      from: sourceLocation,
      to: task.location_code,
      shopId,
    }
  );

  // STOW-MOVEMENT-ID-01 — resolve the exact physical units BEFORE writing
  // movements, so ledger identity is per unit rather than per task.
  //
  // Two independent uniqueness mechanisms previously collapsed any second
  // movement for one task into a silent no-op:
  //   1. device_event_id = uuidv5(stowTaskId:...) + onConflict.ignore()
  //   2. inventory_movements_shop_ref_unique
  //      (shop_id, reference_type, reference_id, variant, location, movement_type)
  // Both are satisfied naturally once reference_id is the unit, matching the
  // sub-parent granularity pickScan already uses (pick_reservation_allocation).
  // movement_type stays 'location_transfer' — rebuildInventoryProjection
  // filters on movement_type only (INV-PROJ-MULTILOC-01), so replay is unaffected.
  const stowUnitIds: string[] = [];

  if (isInboundStock) {
    if (!lasyncroUnitId) {
      throw new Error('[STOW_CONFIRM] INBOUND_LSU_REQUIRED');
    }
    stowUnitIds.push(lasyncroUnitId);
  } else if (lasyncroUnitId) {
    stowUnitIds.push(lasyncroUnitId);

    const scannedUnit = await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
      .select('receive_job_line_id')
      .first();

    const remaining = qty - 1;
    if (remaining > 0 && scannedUnit?.receive_job_line_id) {
      const siblingIds = await trx('inventory_units')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: task.lasyncro_variant_id,
          receive_job_line_id: scannedUnit.receive_job_line_id,
          status: isCancelledPickRecovery ? 'picked' : 'received',
        })
        .whereNot({ lasyncro_unit_id: lasyncroUnitId })
        .limit(remaining)
        .pluck('lasyncro_unit_id');

      if (isCancelledPickRecovery && siblingIds.length !== remaining) {
        throw new Error(
          `[STOW_CONFIRM] Cancelled-pick recovery unit count mismatch: expected ${qty}, matched ${siblingIds.length + 1}`
        );
      }

      stowUnitIds.push(...siblingIds);
    }
  } else {
    // No LSU scanned — FIFO-resolve received units from the task itself.
    const fifoIds = await trx('inventory_units')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: task.lasyncro_variant_id,
        status: 'received',
      })
      .orderBy('received_at', 'asc')
      .limit(qty)
      .pluck('lasyncro_unit_id');

    stowUnitIds.push(...fifoIds);
  }

  if (stowUnitIds.length === 0) {
    throw new Error(
      `[STOW_CONFIRM] No physical units resolved for task ${stowTaskId}`
    );
  }

  // STOW-SPLIT-01 — inventory_units has two identities with different roles:
  // - lasyncro_unit_id is the operator/scanner identity (for example LSU-1684134b)
  // - id is the UUID database identity used by UUID-typed ledger references.
  //
  // inventory_movements.reference_id is UUID, so never write the LSU label into
  // that column. Resolve the immutable inventory-unit row UUID once and retain
  // the LSU string only for scanner identity and deterministic event hashing.
  const unitReferenceRows = await trx('inventory_units')
    .where({ shop_id: shopId })
    .whereIn('lasyncro_unit_id', stowUnitIds)
    .select('id', 'lasyncro_unit_id');

  const unitReferenceIdByLsu = new Map<string, string>(
    unitReferenceRows.map((row) => [
      row.lasyncro_unit_id,
      row.id,
    ])
  );

  const unresolvedReferenceIds = stowUnitIds.filter(
    (unitId) => !unitReferenceIdByLsu.has(unitId)
  );

  if (unresolvedReferenceIds.length > 0) {
    throw new Error(
      `[STOW_CONFIRM] Inventory-unit UUID missing for ${unresolvedReferenceIds.join(', ')}`
    );
  }

  // 3. Write inventory movements — one debit/credit pair PER UNIT.
  let firstCreditMovementId: string | null = null;

  for (const unitId of stowUnitIds) {
    const unitReferenceId = unitReferenceIdByLsu.get(unitId);

    if (!unitReferenceId) {
      // Defensive invariant: the preflight above should make this unreachable.
      // Keep the failure explicit rather than emitting an untraceable movement.
      throw new Error(
        `[STOW_CONFIRM] Inventory-unit UUID unresolved for ${unitId}`
      );
    }
    const creditMovementId = uuidv5(
      `${stowTaskId}:${unitId}:location_transfer:credit`,
      STOW_NAMESPACE
    );
    const creditDeviceEventId = uuidv5(
      `${stowTaskId}:${unitId}:device:credit`,
      STOW_NAMESPACE
    );
    if (!firstCreditMovementId) firstCreditMovementId = creditMovementId;

    if (!isInventoryCredit) {
      if (!sourceLocation) {
        throw new Error(`[STOW_CONFIRM] Source location missing for transfer ${stowTaskId}`);
      }

      await trx('inventory_movements')
        .insert({
          lasyncro_inventory_movement_id: uuidv5(
            `${stowTaskId}:${unitId}:location_transfer:debit`,
            STOW_NAMESPACE
          ),
          lasyncro_variant_id: task.lasyncro_variant_id,
          shop_id: shopId,
          movement_type: 'location_transfer',
          quantity_delta: -1,
          location_code: sourceLocation,
          reference_type: 'inventory_unit',

          // STOW-SPLIT-01 — ledger references are database identities, not printed
          // LSU labels. The LSU remains part of the deterministic event key above.
          reference_id: unitReferenceId,

          platform: 'wms',
          occurred_at: completedAt,
          device_event_id: uuidv5(
            `${stowTaskId}:${unitId}:device:debit`,
            STOW_NAMESPACE
          ),
          operator_id: claimedBy,
          triggered_by: 'stow',
        })
        .onConflict(['device_event_id'])
        .ignore();
    }

    await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: creditMovementId,
        lasyncro_variant_id: task.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: isReturnRestockCredit
          ? 'refund_return'
          : 'location_transfer',
        quantity_delta: 1,
        location_code: task.location_code,
        reference_type: 'inventory_unit',

        // Same physical unit as the debit side of the transfer. Both ledger rows
        // therefore reference one canonical inventory_units.id UUID.
        reference_id: unitReferenceId,

        platform: 'wms',
        occurred_at: completedAt,
        device_event_id: creditDeviceEventId,
        operator_id: claimedBy,
        triggered_by: 'stow',
      })
      .onConflict(['device_event_id'])
      .ignore();
  }

  // 3c. Link credit movement back to stow task for traceability
  // Single-valued column, no readers in src — holds the first unit's credit.
  await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId })
    .update({ inventory_movement_id: firstCreditMovementId });

  console.info('[STOW_MOVEMENTS_WRITTEN]', {
    stowTaskId,
    unitCount: stowUnitIds.length,
    firstCreditMovementId,
    from: sourceLocation,
    to: task.location_code,
    qty,
  });

  // 4. Mark the resolved units stowed. Unit resolution now happens above, in
  // one place, so the ledger and inventory_units agree by construction — the
  // old 4a/4c bulk-sibling pass could move units the movements never covered.
  await trx('inventory_units')
    .whereIn('lasyncro_unit_id', stowUnitIds)
    .andWhere({ shop_id: shopId })
    .update({
      status: 'stowed',
      current_location_code: task.location_code,
      updated_at: completedAt,
    });

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

 // 5. Record placement; complete only when the task's full quantity is placed.
  //
  // STOW-COMPLETE-01 — this previously completed unconditionally, so a
  // partial placement closed the task and stranded the remaining units at
  // status='received'. quantity_placed accumulates the units actually
  // moved (stowUnitIds.length, not the requested qty), so a task survives
  // across multiple confirms and stays visible to httpGetStowTasks, which
  // filters on status IN ('pending','in_progress').
  const placedNow = stowUnitIds.length;

  const [updatedTask] = await trx('stow_tasks')
    .where({ stow_task_id: stowTaskId })
    .update({
      quantity_placed: trx.raw('quantity_placed + ?', [placedNow]),
      updated_at: completedAt,
    })
    .returning(['quantity', 'quantity_placed']);

  const isFullyPlaced = updatedTask.quantity_placed >= updatedTask.quantity;

  if (isFullyPlaced) {
    await trx('stow_tasks')
      .where({ stow_task_id: stowTaskId })
      .update({
        status: 'completed',
        completed_at: completedAt,
        updated_at: completedAt,
      });
  }

  console.info(isFullyPlaced ? '[STOW_CONFIRMED]' : '[STOW_PARTIAL_PLACED]', {
    stowTaskId,
    shopId,
    claimedBy,
    placedNow,
    quantityPlaced: updatedTask.quantity_placed,
    quantityTotal: updatedTask.quantity,
  });

  await writeAuditLog(trx, {
    shopId,
    operatorId: claimedBy,
    actionType: 'stow_confirm',
    entityType: 'stow_task',
    entityId: stowTaskId,
    metadata: {
      location_code: task.location_code,

      // STOW-SPLIT-01 — audit facts describe what this transaction actually moved
      // and what remains after the persisted cumulative quantity is updated.
      quantity: placedNow,
      quantity_remaining:
        updatedTask.quantity - updatedTask.quantity_placed,

      lasyncro_variant_id: task.lasyncro_variant_id,
      // STOW-MOVEMENT-ID-01 — movements are now per unit; record the units
      // actually moved rather than a single task-scoped movement id.
      inventory_movement_id: firstCreditMovementId,
      stowed_unit_ids: stowUnitIds,
      quantity_placed_total: updatedTask.quantity_placed,
    },
  });

  if (isInventoryCredit) {
    await enqueueShopSnapshotJob(trx, shopId);
  }

  return {
    isFullyPlaced,
    quantityPlaced: updatedTask.quantity_placed,
    quantityTotal: updatedTask.quantity,
    placedNow,
  };
}
