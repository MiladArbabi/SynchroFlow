// apps/backend/src/services/wms/pickScan.service.ts
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { writeAuditLog } from '../audit/operatorAudit.service.js';

/**
 * PICK SCAN SERVICE (WM-01)
 * --------------------------
 * Confirms a single scan during a pick session.
 *
 * On each confirmed scan:
 * 1. Validates batch is in 'picking' status and owned by operator
 * 2. Validates line item belongs to batch and is not already scanned
 * 3. Validates scanned variant matches line item variant (barcode gate)
 * 4. Writes a 'pick_removal' movement to inventory_movements — the
 *    physical on-hand deduction and operator-activity record
 * 5. Writes to pick_scan_log for audit + UPH tracking
 * 6. Updates pick_batches.units_picked + pick_last_activity_at
 *
 * Idempotency:
 * - device_event_id = uuidv5(batchId + lineItemId) — deterministic
 * - inventory_movements onConflict(['device_event_id']).ignore()
 * - pick_scan_log insert is guarded by line item uniqueness check
 *
 * Caller must:
 * - Operate within a transaction
 * - Have SET LOCAL "app.current_tenant" active
 * - Have SET LOCAL "synchroflow.projection" = 'true' active
 *   (required by inventory_movements write trigger)
 */

const PICK_SCAN_NAMESPACE = 'a3f1c2e4-7b5d-4e8a-9c6f-2d0b1e3a5f7c'; // fixed constant

export interface PickScanInput {
  pickBatchId: string;
  lasyncroLineItemId: string;
  lasyncroVariantId: string;
  reservationAllocationId?: string;
  locationCode: string;
  quantityConfirmed: number;
  scannedBy: number;
  shopId: number;
  /**
   * WEB-PICK-UNIT-01: LSU- unit ID resolved at product-scan time.
   * Optional — undefined on legacy EAN/UPC/SKU path.
   * When present, bulk-updates inventory_units stowed → picked for
   * scanned unit + siblings from same receive_job_line_id up to qty.
   */
  lasyncroUnitId?: string;
  scanSource?: 'camera' | 'usb' | 'bt' | 'manual';
}

export interface PickScanResult {
  scan_id: string;
  inventory_movement_id: string;
}

export async function confirmPickScan(
  trx: Knex.Transaction,
  input: PickScanInput
): Promise<PickScanResult> {
  const {
    pickBatchId,
    lasyncroLineItemId,
    lasyncroVariantId,
    reservationAllocationId,
    locationCode,
    quantityConfirmed,
    scannedBy,
    shopId,
    scanSource = 'camera', // default: app camera picks
    lasyncroUnitId,
  } = input;

  // Lifecycle anchors precede membership, warehouse, allocation and truth locks.
  const discoveredLine = await trx('order_line_items')
    .where({ lasyncro_line_item_id: lasyncroLineItemId })
    .first('lasyncro_order_id');
  const order = discoveredLine && await trx('orders')
    .where({ shop_id: shopId, lasyncro_order_id: discoveredLine.lasyncro_order_id })
    .forUpdate()
    .first('lasyncro_order_id');
  if (!order) {
    throw new Error(`[PICK_SCAN] Line item not found in batch: ${lasyncroLineItemId}`);
  }

  // 1. Validate batch status and ownership under the batch lock.
  const batch = await trx('pick_batches')
    .where({ pick_batch_id: pickBatchId, shop_id: shopId })
    .select('status', 'picked_by')
    .forUpdate()
    .first();

  if (!batch) {
    throw new Error(`[PICK_SCAN] Batch not found: ${pickBatchId}`);
  }

  if (batch.status !== 'picking') {
    throw new Error(`[PICK_SCAN] Batch not in picking status: ${batch.status}`);
  }

  if (batch.picked_by !== scannedBy) {
    throw new Error(`[PICK_SCAN] Batch owned by different operator`);
  }

  // 2. Validate line item belongs to batch
  const lineItem = await trx('order_line_items as oli')
    .join(
      'pick_batch_orders as pbo',
      'pbo.lasyncro_order_id',
      'oli.lasyncro_order_id'
    )
    .where({
      'oli.lasyncro_line_item_id': lasyncroLineItemId,
      'oli.lasyncro_order_id': order.lasyncro_order_id,
      'pbo.shop_id': shopId,
      'pbo.pick_batch_id': pickBatchId,
    })
    .select(
      'oli.lasyncro_variant_id',
      'oli.quantity',
      'oli.lasyncro_order_id'
    )
    .forUpdate()
    .first();

    if (!lineItem) {
      throw new Error(
        `[PICK_SCAN] Line item not found in batch: ${lasyncroLineItemId}`
      );
    }

    const warehouseState =
      await trx('order_line_item_warehouse_status')
        .where({
          shop_id: shopId,
          lasyncro_line_item_id: lasyncroLineItemId,
        })
        .forUpdate()
        .first('status');

    if (warehouseState?.status === 'shipped') {
      throw new Error(
        `[PICK_SCAN] Line item already shipped: ${lasyncroLineItemId}`
      );
    }

    // 3. Barcode gate — scanned variant must match the requested line item.
    // Applies to both allocation-backed and legacy batches.
    if (lineItem.lasyncro_variant_id !== lasyncroVariantId) {
      throw new Error(
        `[PICK_SCAN] Variant mismatch — scanned: ${lasyncroVariantId}, expected: ${lineItem.lasyncro_variant_id}`
      );
    }

  /**
   * INV-RES-01 Step 2C — allocation identity gate.
   *
   * Allocation-backed picks must identify the exact persisted reservation
   * allocation. The old line-based mutation remains blocked until the
   * allocation is fully validated and consumed atomically.
   */
  const allocationBackedLine =
  await trx('pick_reservation_allocations')
    .where({
      shop_id: shopId,
      pick_batch_id: pickBatchId,
      lasyncro_line_item_id: lasyncroLineItemId,
    })
    .first('allocation_id');

  if (allocationBackedLine && !reservationAllocationId) {
    throw new Error(
      '[PICK_SCAN] RESERVATION_ALLOCATION_REQUIRED'
    );
  }

  if (allocationBackedLine) {
    const reservationAllocation =
      await trx('pick_reservation_allocations')
        .where({
          allocation_id: reservationAllocationId,
          shop_id: shopId,
          pick_batch_id: pickBatchId,
          lasyncro_line_item_id: lasyncroLineItemId,
          lasyncro_variant_id: lasyncroVariantId,
          location_code: locationCode,
          quantity: quantityConfirmed,
        })
        .forUpdate()
        .first('allocation_id');

    if (!reservationAllocation) {
      throw new Error(
        '[PICK_SCAN] RESERVATION_ALLOCATION_MISMATCH'
      );
    }

    const inventoryTruth = await trx('inventory_truth')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: lasyncroVariantId,
        location_code: locationCode,
      })
      .forUpdate()
      .select(
        'on_hand_quantity',
        'reserved_quantity'
      )
      .first();

    if (!inventoryTruth) {
      throw new Error(
        '[PICK_SCAN] INVENTORY_TRUTH_NOT_FOUND'
      );
    }

    if (
      Number(inventoryTruth.on_hand_quantity) <
      quantityConfirmed
    ) {
      throw new Error(
        '[PICK_SCAN] INSUFFICIENT_ON_HAND'
      );
    }

    if (
      Number(inventoryTruth.reserved_quantity) <
      quantityConfirmed
    ) {
      throw new Error(
        '[PICK_SCAN] INSUFFICIENT_RESERVED'
      );
    }
  }

  /**
   * GH-1049 cross-outcome guard.
   *
   * A pick-stage exception is the allocation's recorded physical outcome.
   * Once it exists the allocation may not also be confirmed as a normal full
   * pick. The allocation row is already locked FOR UPDATE above, so this
   * serializes against a concurrent exception report on the same allocation.
   *
   * short_pick is exempt by construction: its confirmed scan and its exception
   * are written together as one composite operation by
   * recordShortPickPhysicalOutcome, not through this path.
   */
  if (allocationBackedLine) {
    const allocationException = await trx('pick_exceptions')
      .where({
        shop_id: shopId,
        reservation_allocation_id: reservationAllocationId,
        stage: 'pick',
      })
      .first('pick_exception_id');

    if (allocationException) {
      throw new Error('[PICK_SCAN] ALLOCATION_EXCEPTION_EXISTS');
    }
  }

  // 4. Guard against duplicate confirmed scan for this pick task.
  // Allocation-backed batches use allocation identity; legacy batches
  // preserve the existing line-level duplicate guard.
  const existingScan = allocationBackedLine
    ? await trx('pick_scan_log')
        .where({
          pick_batch_id: pickBatchId,
          reservation_allocation_id: reservationAllocationId,
          status: 'confirmed',
        })
        .first()
    : await trx('pick_scan_log')
        .where({
          pick_batch_id: pickBatchId,
          lasyncro_line_item_id: lasyncroLineItemId,
          status: 'confirmed',
        })
        .first();

  if (existingScan) {
    throw new Error(
      allocationBackedLine
        ? `[PICK_SCAN] Reservation allocation already scanned: ${reservationAllocationId}`
        : `[PICK_SCAN] Line item already scanned: ${lasyncroLineItemId}`
    );
  }

  // 5. Deterministic inventory movement id + device_event_id.
  // Allocation-backed tasks use allocation identity so split line items
  // produce independent, idempotent pick_removal movements.
  const pickTaskIdentity = allocationBackedLine
    ? reservationAllocationId!
    : lasyncroLineItemId;

  const inventoryMovementId = uuidv5(
    `${pickBatchId}:${pickTaskIdentity}:inventory:sale`,
    PICK_SCAN_NAMESPACE
  );

  const deviceEventId = uuidv5(
    `${pickBatchId}:${pickTaskIdentity}:sale`,
    PICK_SCAN_NAMESPACE
  );

  const scannedAt = new Date();

  // 6. Write physical pick_removal movement to inventory ledger.
  const insertedPickRemovals = await trx('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: inventoryMovementId,
      lasyncro_variant_id: lasyncroVariantId,
      shop_id: shopId,
      /*
        * INV-SALE-DOUBLE-01 / INV-INGEST-TRUTH-01 (2026-08-14)
        * ------------------------------------------------------
        * `sale` remains the economic order event written at ingestion.
        * It is deliberately excluded from physical on-hand reconstruction.
        *
        * `pick_removal` is the physical outbound movement for a confirmed
        * WMS pick. It is also the operator-activity signal carrying
        * operator_id and scan_source.
        *
        * Shopify fulfillment for quantity that was not physically picked
        * is represented separately by `fulfillment_removal`.
        */
      movement_type: 'pick_removal',
      quantity_delta: -quantityConfirmed,
      location_code: locationCode,
        /*
        * INV-SALE-REFTYPE-01 (2026-08-14)
        * --------------------------------
        * reference_id here is a LINE ITEM id, not a revenue unit id.
        * This block previously declared reference_type='order_revenue_unit'
        * — the same label revenue-units.writer.ts:274 uses for a genuine
        * lasyncro_revenue_unit_id — so the ledger carried two different
        * entity types under one name. reference_type is varchar and no
        * reader filters on it (verified), so the label is corrected to
        * name what is actually referenced. Matches the entity-naming
        * convention of the existing vocabulary: pick_batch,
        * pick_reservation_allocation, inventory_unit, receive_job.
        *
        * INV-SALE-DOUBLE-01 / INV-INGEST-TRUTH-01
        * -----------------------------------------
        * This site writes `pick_removal`, the physical outbound movement
        * for a confirmed WMS pick.
        *
        * `sale` remains a separate ingestion-time economic event and is
        * not included in physical on-hand reconstruction.
        *
        * Idempotency is enforced by device_event_id. Each writer derives
        * its device_event_id from its own deterministic uuidv5 namespace.
        *
        * Historical pre-0147 pick rows may still carry movement_type='sale'
        * with triggered_by='pick_scan'. Rebuild compatibility recognizes those
        * rows directly as physical removals. Any inv_sale_backfill_01
        * compensating correction remains physically neutral, so rebuild does
        * not depend on whether that historical backfill was previously run.
        */
      reference_type: 'order_line_item',
      reference_id: lasyncroLineItemId,
      platform: null,
      scan_source: scanSource,
      occurred_at: scannedAt,
      device_event_id: deviceEventId,
      operator_id: scannedBy,
      triggered_by: 'pick_scan',
    })
    .onConflict(['device_event_id'])
    .ignore()
    .returning('lasyncro_inventory_movement_id');

    if (
      allocationBackedLine &&
      insertedPickRemovals.length !== 1
    ) {
      throw new Error(
        '[PICK_SCAN] PICK_REMOVAL_ALREADY_EXISTS'
      );
    }

    if (allocationBackedLine) {
      const reservationReleaseMovementId = uuidv5(
        `${pickBatchId}:${reservationAllocationId}:inventory:reservation_release`,
        PICK_SCAN_NAMESPACE
      );

      const reservationReleaseDeviceEventId = uuidv5(
        `${pickBatchId}:${reservationAllocationId}:reservation_release`,
        PICK_SCAN_NAMESPACE
      );

      const insertedReservationReleases =
        await trx('inventory_movements')
          .insert({
            lasyncro_inventory_movement_id:
              reservationReleaseMovementId,
            lasyncro_variant_id: lasyncroVariantId,
            shop_id: shopId,
            movement_type: 'reservation_release',
            quantity_delta: -quantityConfirmed,
            location_code: locationCode,
            reference_type: 'pick_reservation_allocation',
            reference_id: reservationAllocationId!,
            platform: 'wms',
            scan_source: scanSource,
            occurred_at: scannedAt,
            device_event_id: reservationReleaseDeviceEventId,
            operator_id: scannedBy,
            triggered_by: 'pick_scan',
          })
          .onConflict([
            'shop_id',
            'reference_type',
            'reference_id',
            'lasyncro_variant_id',
            'location_code',
            'movement_type',
          ])
          .ignore()
          .returning('lasyncro_inventory_movement_id');

      if (insertedReservationReleases.length !== 1) {
        throw new Error(
          '[PICK_SCAN] RESERVATION_RELEASE_ALREADY_EXISTS'
        );
      }

      const updatedTruthRows = await trx('inventory_truth')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: lasyncroVariantId,
          location_code: locationCode,
        })
        .where('on_hand_quantity', '>=', quantityConfirmed)
        .where('reserved_quantity', '>=', quantityConfirmed)
        .update({
          on_hand_quantity: trx.raw(
            'on_hand_quantity - ?',
            [quantityConfirmed]
          ),
          reserved_quantity: trx.raw(
            'reserved_quantity - ?',
            [quantityConfirmed]
          ),
          last_evaluated_at: scannedAt,
          updated_at: scannedAt,
        });

      if (updatedTruthRows !== 1) {
        throw new Error(
          '[PICK_SCAN] INVENTORY_TRUTH_UPDATE_FAILED'
        );
      }
    }

    console.info('[PICK_SCAN_MOVEMENT_WRITTEN]', {
      inventoryMovementId,
      lasyncroVariantId,
      quantityConfirmed,
      shopId,
      pickBatchId,
    });

  // 7. Write to pick_scan_log
  const scanId = randomUUID();

  await trx('pick_scan_log').insert({
    scan_id: scanId,
    shop_id: shopId,
    pick_batch_id: pickBatchId,
    lasyncro_line_item_id: lasyncroLineItemId,
    lasyncro_variant_id: lasyncroVariantId,
    reservation_allocation_id: allocationBackedLine
      ? reservationAllocationId!
      : null,
    lasyncro_unit_id: lasyncroUnitId ?? null,
    location_code: locationCode,
    quantity_confirmed: quantityConfirmed,
    status: 'confirmed',
    scanned_by: scannedBy,
    scanned_at: scannedAt,
    inventory_movement_id: inventoryMovementId,
  });

  // 8. Update batch activity + units_picked
  await trx('pick_batches')
    .where({ pick_batch_id: pickBatchId })
    .update({
      units_picked: trx.raw('units_picked + ?', [quantityConfirmed]),
      pick_last_activity_at: scannedAt,
      updated_at: scannedAt,
    });

  console.info('[PICK_SCAN_CONFIRMED]', {
    scan_id: scanId,
    pickBatchId,
    lasyncroLineItemId,
    lasyncroVariantId,
    quantityConfirmed,
    scannedBy,
    shopId,
  });

  // 9. Transition line item warehouse status → picked.
  //
  // Legacy lines preserve the existing one-scan-per-line behavior.
  // Allocation-backed lines become picked only after every persisted
  // allocation for the line has a confirmed scan.
  let shouldMarkLinePicked = true;

  if (allocationBackedLine) {
    const totalAllocationRow =
      await trx('pick_reservation_allocations')
        .where({
          shop_id: shopId,
          pick_batch_id: pickBatchId,
          lasyncro_line_item_id: lasyncroLineItemId,
        })
        .count({ count: 'allocation_id' })
        .first();

    const confirmedAllocationRow =
      await trx('pick_scan_log')
        .where({
          shop_id: shopId,
          pick_batch_id: pickBatchId,
          lasyncro_line_item_id: lasyncroLineItemId,
          status: 'confirmed',
        })
        .whereNotNull('reservation_allocation_id')
        .countDistinct({ count: 'reservation_allocation_id' })
        .first();

    shouldMarkLinePicked =
      Number(confirmedAllocationRow?.count ?? 0) ===
      Number(totalAllocationRow?.count ?? 0);
  }

  if (shouldMarkLinePicked) {
    await trx('order_line_item_warehouse_status')
      .insert({
        lasyncro_line_item_id: lasyncroLineItemId,
        lasyncro_order_id: lineItem.lasyncro_order_id,
        shop_id: shopId,
        status: 'picked',
        status_updated_at: scannedAt,
        created_at: scannedAt,
        updated_at: scannedAt,
      })
      .onConflict(['lasyncro_line_item_id'])
      .merge({
        status: 'picked',
        status_updated_at: scannedAt,
        updated_at: scannedAt,
      });
    }

    // 10. Transition legacy inventory_unit_status → picked (pre-WM-46 compat)
  await trx('inventory_unit_status')
    .insert({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
      status: 'picked',
      status_updated_at: scannedAt,
      created_at: scannedAt,
      updated_at: scannedAt,
    })
    .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
    .merge({
      status: 'picked',
      status_updated_at: scannedAt,
      updated_at: scannedAt,
    });

  // 11. Bulk-update inventory_units → picked (WEB-PICK-UNIT-01)
  // LSU- path only. Scanned unit updated first (guaranteed inclusion),
  // then remaining qty-1 stowed siblings from same receive_job_line_id
  // updated in one pass. current_location_code nulled — unit left the shelf.
  if (lasyncroUnitId) {
    const scannedUnitQuery = trx('inventory_units')
      .where({
        shop_id: shopId,
        lasyncro_unit_id: lasyncroUnitId,
      });

    if (allocationBackedLine) {
      scannedUnitQuery.andWhere({
        lasyncro_variant_id: lasyncroVariantId,
        current_location_code: locationCode,
        status: 'stowed',
      });
    }

    const scannedUnit = allocationBackedLine
      ? await scannedUnitQuery
          .forUpdate()
          .select('receive_job_line_id')
          .first()
      : await scannedUnitQuery
          .select('receive_job_line_id')
          .first();

    if (allocationBackedLine && !scannedUnit) {
      throw new Error(
        '[PICK_SCAN] INVENTORY_UNIT_MISMATCH'
      );
    }

    if (scannedUnit?.receive_job_line_id) {
      const transitionedUnits = await trx('inventory_units')
        .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
        .update({
          status: 'picked',
          current_location_code: null,
          updated_at: scannedAt,
        })
        .returning('lasyncro_unit_id');
      await trx('pick_scan_unit_lineage').insert(transitionedUnits.map(unit => ({
        scan_id: scanId, shop_id: shopId, lasyncro_unit_id: unit.lasyncro_unit_id,
      })));

      const remaining = quantityConfirmed - 1;
      if (remaining > 0) {
        const siblingIds = await trx('inventory_units')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: lasyncroVariantId,
            receive_job_line_id: scannedUnit.receive_job_line_id,
            current_location_code: locationCode,
            status: 'stowed',
          })
          .whereNot({ lasyncro_unit_id: lasyncroUnitId })
          .orderBy('lasyncro_unit_id')
          .forUpdate()
          .limit(remaining)
          .pluck('lasyncro_unit_id');

        if (siblingIds.length > 0) {
          const transitionedSiblings = await trx('inventory_units')
            .whereIn('lasyncro_unit_id', siblingIds)
            .andWhere({ shop_id: shopId, status: 'stowed', current_location_code: locationCode })
            .update({
              status: 'picked',
              current_location_code: null,
              updated_at: scannedAt,
            })
            .returning('lasyncro_unit_id');
          await trx('pick_scan_unit_lineage').insert(transitionedSiblings.map(unit => ({
            scan_id: scanId, shop_id: shopId, lasyncro_unit_id: unit.lasyncro_unit_id,
          })));
        }
      }
    }

    console.info('[PICK_UNIT_BULK_UPDATED]', {
      lasyncroUnitId,
      lasyncroVariantId,
      quantityConfirmed,
      shopId,
      pickBatchId,
    });
  }

  await writeAuditLog(trx, {
    shopId,
    operatorId: scannedBy,
    actionType: 'pick_scan',
    entityType: 'pick_batch',
    entityId: pickBatchId,
    metadata: {
      lasyncro_line_item_id: lasyncroLineItemId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
      quantity_confirmed: quantityConfirmed,
      ...(lasyncroUnitId ? { lasyncro_unit_id: lasyncroUnitId } : {}),
    },
  });

  return {
    scan_id: scanId,
    inventory_movement_id: inventoryMovementId,
  };
}
/**
 * SHORT-PICK PHYSICAL OUTCOME (GH-1049)
 * --------------------------------------
 * The physical half of a short_pick: the operator found `quantityFound` of an
 * allocation of `allocation.quantity`. This writes ONLY the units actually in
 * the operator's hand. The missing remainder is carried by the Pick exception
 * and its Problem task, not by a fabricated movement.
 *
 * Written inside the caller's exception transaction, so the scan, both
 * movements, inventory_truth and units_picked commit or roll back with the
 * exception and its Problem task.
 *
 * ECONOMIC IDENTITY
 * -----------------
 * Both movements are keyed on the pick_exception_id, NOT on the allocation id.
 * confirmPickScan's full-allocation reservation_release already owns
 * (shop_id, 'pick_reservation_allocation', allocation_id, variant, location,
 * 'reservation_release'). Reusing that identity here would consume the
 * allocation's one reservation_release row and silently swallow the later
 * disposition of the remaining reserved units — the residual settlement that
 * write_off / discard / re-stow resolution will need. Keying on the exception
 * leaves the allocation-scoped identity free for that separate economic event.
 *
 * Caller must have SET LOCAL "app.current_tenant" and
 * SET LOCAL "synchroflow.projection" = 'true' active, and must already hold
 * the pick_reservation_allocations row lock.
 */
export interface ShortPickPhysicalOutcomeInput {
  shopId: number;
  pickBatchId: string;
  pickExceptionId: string;
  reservationAllocationId: string;
  lasyncroLineItemId: string;
  lasyncroVariantId: string;
  locationCode: string;
  quantityFound: number;
  scannedBy: number;
  scanSource?: 'camera' | 'usb' | 'bt' | 'manual';
}

export interface ShortPickPhysicalOutcomeResult {
  scan_id: string;
  inventory_movement_id: string;
  reservation_release_movement_id: string;
}

export async function recordShortPickPhysicalOutcome(
  trx: Knex.Transaction,
  input: ShortPickPhysicalOutcomeInput
): Promise<ShortPickPhysicalOutcomeResult> {
  const {
    shopId,
    pickBatchId,
    pickExceptionId,
    reservationAllocationId,
    lasyncroLineItemId,
    lasyncroVariantId,
    locationCode,
    quantityFound,
    scannedBy,
    scanSource = 'manual',
  } = input;

  if (!Number.isInteger(quantityFound) || quantityFound <= 0) {
    throw new Error('[PICK_SHORT] QUANTITY_FOUND_INVALID');
  }

  const inventoryTruth = await trx('inventory_truth')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
    })
    .forUpdate()
    .select('on_hand_quantity', 'reserved_quantity')
    .first();

  if (!inventoryTruth) {
    throw new Error('[PICK_SHORT] INVENTORY_TRUTH_NOT_FOUND');
  }

  if (Number(inventoryTruth.on_hand_quantity) < quantityFound) {
    throw new Error('[PICK_SHORT] INSUFFICIENT_ON_HAND');
  }

  if (Number(inventoryTruth.reserved_quantity) < quantityFound) {
    throw new Error('[PICK_SHORT] INSUFFICIENT_RESERVED');
  }

  const occurredAt = new Date();

  const inventoryMovementId = uuidv5(
    `${pickBatchId}:${pickExceptionId}:inventory:short_pick_removal`,
    PICK_SCAN_NAMESPACE
  );

  const insertedPickRemovals = await trx('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: inventoryMovementId,
      lasyncro_variant_id: lasyncroVariantId,
      shop_id: shopId,
      movement_type: 'pick_removal',
      quantity_delta: -quantityFound,
      location_code: locationCode,
      reference_type: 'pick_exception',
      reference_id: pickExceptionId,
      platform: null,
      scan_source: scanSource,
      occurred_at: occurredAt,
      device_event_id: uuidv5(
        `${pickBatchId}:${pickExceptionId}:short_pick_removal`,
        PICK_SCAN_NAMESPACE
      ),
      operator_id: scannedBy,
      triggered_by: 'pick_exception',
    })
    .onConflict(['device_event_id'])
    .ignore()
    .returning('lasyncro_inventory_movement_id');

  if (insertedPickRemovals.length !== 1) {
    throw new Error('[PICK_SHORT] PICK_REMOVAL_ALREADY_EXISTS');
  }

  const reservationReleaseMovementId = uuidv5(
    `${pickBatchId}:${pickExceptionId}:inventory:short_reservation_release`,
    PICK_SCAN_NAMESPACE
  );

  const insertedReservationReleases = await trx('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: reservationReleaseMovementId,
      lasyncro_variant_id: lasyncroVariantId,
      shop_id: shopId,
      movement_type: 'reservation_release',
      quantity_delta: -quantityFound,
      location_code: locationCode,
      reference_type: 'pick_exception',
      reference_id: pickExceptionId,
      platform: 'wms',
      scan_source: scanSource,
      occurred_at: occurredAt,
      device_event_id: uuidv5(
        `${pickBatchId}:${pickExceptionId}:short_reservation_release`,
        PICK_SCAN_NAMESPACE
      ),
      operator_id: scannedBy,
      triggered_by: 'pick_exception',
    })
    .onConflict([
      'shop_id',
      'reference_type',
      'reference_id',
      'lasyncro_variant_id',
      'location_code',
      'movement_type',
    ])
    .ignore()
    .returning('lasyncro_inventory_movement_id');

  if (insertedReservationReleases.length !== 1) {
    throw new Error('[PICK_SHORT] RESERVATION_RELEASE_ALREADY_EXISTS');
  }

  const updatedTruthRows = await trx('inventory_truth')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
    })
    .where('on_hand_quantity', '>=', quantityFound)
    .where('reserved_quantity', '>=', quantityFound)
    .update({
      on_hand_quantity: trx.raw('on_hand_quantity - ?', [quantityFound]),
      reserved_quantity: trx.raw('reserved_quantity - ?', [quantityFound]),
      last_evaluated_at: occurredAt,
      updated_at: occurredAt,
    });

  if (updatedTruthRows !== 1) {
    throw new Error('[PICK_SHORT] INVENTORY_TRUTH_UPDATE_FAILED');
  }

  const scanId = randomUUID();

  /**
   * The confirmed scan records the units physically removed, not the
   * allocation total. pick_scan_log_confirmed_allocation_unique still admits
   * exactly one confirmed scan for this allocation.
   *
   * order_line_item_warehouse_status is deliberately NOT advanced to 'picked':
   * the line is short. Pack-stage handling of that state is a later slice.
   */
  await trx('pick_scan_log').insert({
    scan_id: scanId,
    shop_id: shopId,
    pick_batch_id: pickBatchId,
    lasyncro_line_item_id: lasyncroLineItemId,
    lasyncro_variant_id: lasyncroVariantId,
    reservation_allocation_id: reservationAllocationId,
    lasyncro_unit_id: null,
    location_code: locationCode,
    quantity_confirmed: quantityFound,
    status: 'confirmed',
    scanned_by: scannedBy,
    scanned_at: occurredAt,
    inventory_movement_id: inventoryMovementId,
  });

  await trx('pick_batches')
    .where({ pick_batch_id: pickBatchId })
    .update({
      units_picked: trx.raw('units_picked + ?', [quantityFound]),
      pick_last_activity_at: occurredAt,
      updated_at: occurredAt,
    });

  console.info('[PICK_SHORT_PICK_RECORDED]', {
    pickBatchId,
    pickExceptionId,
    reservationAllocationId,
    quantityFound,
    shopId,
  });

  return {
    scan_id: scanId,
    inventory_movement_id: inventoryMovementId,
    reservation_release_movement_id: reservationReleaseMovementId,
  };
}
