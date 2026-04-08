// apps/backend/src/services/wms/packScan.service.ts
import { Knex } from 'knex';
import { randomUUID } from 'crypto';

/**
 * PACK SCAN SERVICE
 * -----------------
 * Confirms a single scan during a pack session.
 *
 * Pack scans verify order completeness before shipment:
 * - Single-item order: scan item → all confirmed → ready to ship
 * - Multi-item order: scan each item → all confirmed → ready to ship
 *
 * Differences from pick scan:
 * - No inventory movement — deduction already written at pick scan
 * - Order-centric — packer works per order, not per location
 * - Writes to pack_scan_log only
 *
 * Idempotency:
 * - Guard on (pick_batch_id, lasyncro_line_item_id, status=confirmed)
 * - Prevents double-scan at pack station
 *
 * Caller must:
 * - Operate within a transaction
 * - Have SET LOCAL "app.current_tenant" active
 */

export interface PackScanInput {
  pickBatchId: string;
  lasyncroOrderId: string;
  lasyncroLineItemId: string;
  lasyncroVariantId: string;
  quantityConfirmed: number;
  scannedBy: number;
  shopId: number;
}

export interface PackScanResult {
  scan_id: string;
  order_complete: boolean; // true if all line items for this order are now scanned
}

export async function confirmPackScan(
  trx: Knex.Transaction,
  input: PackScanInput
): Promise<PackScanResult> {
  const {
    pickBatchId,
    lasyncroOrderId,
    lasyncroLineItemId,
    lasyncroVariantId,
    quantityConfirmed,
    scannedBy,
    shopId,
  } = input;

  // 1. Validate batch is in 'packing' status and owned by packer
  const batch = await trx('pick_batches')
    .where({ pick_batch_id: pickBatchId, shop_id: shopId })
    .select('status', 'packed_by')
    .first();

  if (!batch) throw new Error(`[PACK_SCAN] Batch not found: ${pickBatchId}`);
  if (batch.status !== 'packing') throw new Error(`[PACK_SCAN] Batch not in packing status: ${batch.status}`);
  if (batch.packed_by !== scannedBy) throw new Error(`[PACK_SCAN] Batch owned by different packer`);

  // 2. Validate line item belongs to this order and batch
  const lineItem = await trx('order_line_items as oli')
    .join('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'oli.lasyncro_order_id')
    .where({
      'oli.lasyncro_line_item_id': lasyncroLineItemId,
      'oli.lasyncro_order_id': lasyncroOrderId,
      'pbo.pick_batch_id': pickBatchId,
    })
    .select('oli.lasyncro_variant_id', 'oli.quantity')
    .first();

  if (!lineItem) throw new Error(`[PACK_SCAN] Line item not found in batch: ${lasyncroLineItemId}`);

  // 3. Barcode gate — scanned variant must match line item variant
  if (lineItem.lasyncro_variant_id !== lasyncroVariantId) {
    throw new Error(
      `[PACK_SCAN] Variant mismatch — scanned: ${lasyncroVariantId}, expected: ${lineItem.lasyncro_variant_id}`
    );
  }

  // 4. Guard against duplicate confirmed scan
  const existingScan = await trx('pack_scan_log')
    .where({
      pick_batch_id: pickBatchId,
      lasyncro_line_item_id: lasyncroLineItemId,
      status: 'confirmed',
    })
    .first();

  if (existingScan) throw new Error(`[PACK_SCAN] Line item already scanned at pack: ${lasyncroLineItemId}`);

  const scannedAt = new Date();
  const scanId = randomUUID();

  // 5. Write to pack_scan_log
  await trx('pack_scan_log').insert({
    scan_id: scanId,
    shop_id: shopId,
    pick_batch_id: pickBatchId,
    lasyncro_order_id: lasyncroOrderId,
    lasyncro_line_item_id: lasyncroLineItemId,
    lasyncro_variant_id: lasyncroVariantId,
    quantity_confirmed: quantityConfirmed,
    status: 'confirmed',
    scanned_by: scannedBy,
    scanned_at: scannedAt,
  });

  // 6. Update batch activity + units_packed
  await trx('pick_batches')
    .where({ pick_batch_id: pickBatchId })
    .update({
      units_packed: trx.raw('units_packed + ?', [quantityConfirmed]),
      pack_last_activity_at: scannedAt,
      updated_at: scannedAt,
    });

  // 7. Transition line item warehouse status → packed
  await trx('order_line_item_warehouse_status')
    .where({ lasyncro_line_item_id: lasyncroLineItemId })
    .update({
      status: 'packed',
      status_updated_at: scannedAt,
      updated_at: scannedAt,
    });

  // 8. Transition inventory unit status → packed
  await trx('inventory_unit_status')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
    })
    .update({
      status: 'packed',
      status_updated_at: scannedAt,
      updated_at: scannedAt,
    });

  // 9. Check if all line items for this order are now scanned at pack
  const totalLineItems = await trx('order_line_items')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .count<{ count: string }>('lasyncro_line_item_id as count')
    .first();

  const scannedLineItems = await trx('pack_scan_log')
    .where({
      pick_batch_id: pickBatchId,
      lasyncro_order_id: lasyncroOrderId,
      status: 'confirmed',
    })
    .count<{ count: string }>('scan_id as count')
    .first();

  const orderComplete =
    Number(scannedLineItems?.count ?? 0) >= Number(totalLineItems?.count ?? 0);

  // 10. If order complete → transition order warehouse status → packed
  if (orderComplete) {
    await trx('order_warehouse_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        status: 'packed',
        packed_at: scannedAt,
        status_updated_at: scannedAt,
        updated_at: scannedAt,
      });
  }

  console.info('[PACK_SCAN_CONFIRMED]', {
    scan_id: scanId,
    pickBatchId,
    lasyncroOrderId,
    lasyncroLineItemId,
    quantityConfirmed,
    orderComplete,
    shopId,
  });

  return { scan_id: scanId, order_complete: orderComplete };
}