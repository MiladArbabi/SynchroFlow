// apps/backend/src/services/wms/shipConfirmation.service.ts
import { Knex } from 'knex';
import orderFulfillmentIngestionService
  from '../order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { writeShopifyFulfillment } from './shopifyFulfillmentWriteback.service.js';

/**
 * SHIP CONFIRMATION SERVICE
 * --------------------------
 * Confirms shipment of a packed order.
 *
 * On confirmation:
 * 1. Validates order is in 'packed' warehouse status
 * 2. Transitions order_warehouse_status → 'shipped'
 * 3. Transitions all line items warehouse status → 'shipped'
 * 4. Transitions inventory_unit_status → 'shipped'
 * 5. Drives order_fulfillment_status → 'fulfilled' via
 *    OrderFulfillmentIngestionService (monotonic, precedence-safe)
 *
 * Partial shipment:
 * - If partialShipment = true → warehouse status → 'partially_shipped'
 * - Drives order_fulfillment_status → 'partially_fulfilled'
 *
 * Caller must:
 * - Operate within a transaction
 * - Have SET LOCAL "app.current_tenant" active
 */

export interface ShipConfirmationInput {
  lasyncroOrderId: string;
  shopId: number;
  partialShipment?: boolean;
  shippedAt?: Date;
}

export async function confirmShipment(
  trx: Knex.Transaction,
  input: ShipConfirmationInput
): Promise<void> {
  const {
    lasyncroOrderId,
    shopId,
    partialShipment = false,
    shippedAt = new Date(),
  } = input;

  // 1. Validate order exists and is in packed status
  const warehouseStatus = await trx('order_warehouse_status')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .select('status')
    .first();

  if (!warehouseStatus) {
    throw new Error(`[SHIP_CONFIRMATION] No warehouse status found for order: ${lasyncroOrderId}`);
  }

  const allowedStatuses = ['packed', 'partially_shipped'];
  if (!allowedStatuses.includes(warehouseStatus.status)) {
    throw new Error(
      `[SHIP_CONFIRMATION] Order not in packed status: ${warehouseStatus.status}`
    );
  }

  const newWarehouseStatus = partialShipment ? 'partially_shipped' : 'shipped';
  const newFulfillmentStatus = partialShipment ? 'partially_fulfilled' : 'fulfilled';

  // 2. Transition order warehouse status → shipped/partially_shipped
  await trx('order_warehouse_status')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .update({
      status: newWarehouseStatus,
      shipped_at: shippedAt,
      status_updated_at: shippedAt,
      updated_at: shippedAt,
    });

  // 3. Transition all line items → shipped
  await trx('order_line_item_warehouse_status')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .update({
      status: newWarehouseStatus,
      status_updated_at: shippedAt,
      updated_at: shippedAt,
    });

  // 4. Transition inventory unit status → shipped
  const lineItems = await trx('order_line_items')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .select('lasyncro_variant_id');

  for (const li of lineItems) {
    await trx('inventory_unit_status')
      .where({ shop_id: shopId, lasyncro_variant_id: li.lasyncro_variant_id })
      .update({
        status: 'shipped',
        status_updated_at: shippedAt,
        updated_at: shippedAt,
      });
  }

  // 5. Drive order_fulfillment_status → fulfilled/partially_fulfilled
   await orderFulfillmentIngestionService.ingestStatus(
    {
      lasyncroOrderId,
      shopId,
      status: newFulfillmentStatus as 'fulfilled' | 'partially_fulfilled',
      canonicalEventTime: shippedAt,
    },
    trx
  );

  // 6. Shopify fulfillment writeback (WM-20)
  // Non-fatal: internal state is already committed. Log and continue on failure.
  try {
    await writeShopifyFulfillment(trx, { lasyncroOrderId, shopId });
  } catch (err) {
    console.error('[SHIP_CONFIRMATION_WRITEBACK_FAILED]', {
      lasyncroOrderId,
      shopId,
      error: (err as Error).message,
    });
  }

  console.info('[SHIP_CONFIRMATION_COMPLETE]', {
    lasyncroOrderId,
    shopId,
    newWarehouseStatus,
    newFulfillmentStatus,
    partialShipment,
    shippedAt,
  });
}