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
 * 4. Writes a 'sale' movement to inventory_movements (at-scan deduction)
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
    locationCode,
    quantityConfirmed,
    scannedBy,
    shopId,
    scanSource = 'camera', // default: app camera picks
    lasyncroUnitId,
  } = input;

  // 1. Validate batch status and ownership
  const batch = await trx('pick_batches')
    .where({ pick_batch_id: pickBatchId, shop_id: shopId })
    .select('status', 'picked_by')
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
    .join('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'oli.lasyncro_order_id')
    .where({
      'oli.lasyncro_line_item_id': lasyncroLineItemId,
      'pbo.pick_batch_id': pickBatchId,
    })
    .select('oli.lasyncro_variant_id', 'oli.quantity', 'oli.lasyncro_order_id')
    .first();

  if (!lineItem) {
    throw new Error(`[PICK_SCAN] Line item not found in batch: ${lasyncroLineItemId}`);
  }

  // 3. Barcode gate — scanned variant must match line item variant
  if (lineItem.lasyncro_variant_id !== lasyncroVariantId) {
    throw new Error(
      `[PICK_SCAN] Variant mismatch — scanned: ${lasyncroVariantId}, expected: ${lineItem.lasyncro_variant_id}`
    );
  }

  // 4. Guard against duplicate confirmed scan for this line item
  const existingScan = await trx('pick_scan_log')
    .where({
      pick_batch_id: pickBatchId,
      lasyncro_line_item_id: lasyncroLineItemId,
      status: 'confirmed',
    })
    .first();

  if (existingScan) {
    throw new Error(`[PICK_SCAN] Line item already scanned: ${lasyncroLineItemId}`);
  }

  // 5. Deterministic inventory movement id + device_event_id
  const inventoryMovementId = uuidv5(
    `${pickBatchId}:${lasyncroLineItemId}:inventory:sale`,
    PICK_SCAN_NAMESPACE
  );

  const deviceEventId = uuidv5(
    `${pickBatchId}:${lasyncroLineItemId}:sale`,
    PICK_SCAN_NAMESPACE
  );

  const scannedAt = new Date();

  // 6. Write sale movement to inventory ledger (at-scan deduction)
  await trx('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: inventoryMovementId,
      lasyncro_variant_id: lasyncroVariantId,
      shop_id: shopId,
      movement_type: 'sale',
      quantity_delta: -quantityConfirmed,
      location_code: locationCode,
      reference_type: 'order_revenue_unit',
      reference_id: lasyncroLineItemId,
      platform: null,
      scan_source: scanSource,
      occurred_at: scannedAt,
      device_event_id: deviceEventId,
      operator_id: scannedBy,        // traceability: operator who confirmed pick
      triggered_by: 'pick_scan',     // traceability: source of movement
    })
    .onConflict(['device_event_id'])
    .ignore();

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

  // 9. Transition line item warehouse status → picked
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
    const scannedUnit = await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
      .select('receive_job_line_id')
      .first();

    if (scannedUnit?.receive_job_line_id) {
      await trx('inventory_units')
        .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
        .update({
          status: 'picked',
          current_location_code: null,
          updated_at: scannedAt,
        });

      const remaining = quantityConfirmed - 1;
      if (remaining > 0) {
        const siblingIds = await trx('inventory_units')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: lasyncroVariantId,
            receive_job_line_id: scannedUnit.receive_job_line_id,
            status: 'stowed',
          })
          .whereNot({ lasyncro_unit_id: lasyncroUnitId })
          .limit(remaining)
          .pluck('lasyncro_unit_id');

        if (siblingIds.length > 0) {
          await trx('inventory_units')
            .whereIn('lasyncro_unit_id', siblingIds)
            .andWhere({ shop_id: shopId })
            .update({
              status: 'picked',
              current_location_code: null,
              updated_at: scannedAt,
            });
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