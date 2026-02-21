/**
 * Inventory Webhook Handler
 * --------------------------
 * Contract:
 * - Mirror Shopify inventory exactly
 * - No direct writes to inventory_truth
 * - All corrections must be movements
 * - Idempotent via device_event_id
 */

import db from '@lasyncro/backend-core/db.js';
import { v5 as uuidv5 } from 'uuid';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { rebuildInventoryProjectionForVariants } from '../../../services/inventory/rebuildInventoryProjection.js';
import { computeObligationFlagsForOrders } from '../../../services/order-execution-intelligence/obligationFlags.worker.js';

const INVENTORY_SYNC_NAMESPACE =
  '7b12c5d0-9e3a-4b18-91e3-2cbb2c0c11aa';

interface ShopifyInventoryPayload {
  inventory_item_id?: number;
  available?: number;
  location_id?: number;
  admin_graphql_api_id?: string;
}

export async function handleInventoryLevelUpdate(
  envelope: WebhookEnvelope
): Promise<void> {

  const payload = envelope.rawPayload as Partial<ShopifyInventoryPayload>;

if (
  payload == null ||
  typeof payload.available !== 'number'
) {
  return;
}

const available: number = payload.available;

  const shopId: number | undefined = envelope.shopId;

  if (typeof shopId !== 'number') {
    return;
  }
  
  const externalInventoryItemId =
    payload.inventory_item_id ?? payload.admin_graphql_api_id;

    if (!externalInventoryItemId) return;

    let variantId: string | null = null;

    await db.transaction(async (trx) => {

    const mapping = await trx('external_product_identity_map')
      .where({
        shop_id: shopId,
        external_inventory_item_id: String(externalInventoryItemId),
      })
      .first();

    if (!mapping) return;

    variantId = mapping?.lasyncro_variant_id ?? null;

    if (!variantId) return;

    const projection = await trx('inventory_truth')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
      })
      .first();

    const projectedQty = Number(projection?.on_hand_quantity ?? 0);
    const delta = available - projectedQty;

    if (delta === 0) return;

    await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        device_event_id: uuidv5(
          `${shopId}:${variantId}:${available}:inventory_sync`,
          INVENTORY_SYNC_NAMESPACE
        ),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: 'reconciliation_correction',
        quantity_delta: delta,
        reference_type: 'shopify_inventory_sync',
        reference_id: envelope.eventId,
        platform: 'shopify',
        location_code: `WH-${shopId}-ROOT`,
        occurred_at: new Date(),
      })
      .onConflict(['device_event_id'])
      .ignore();

    await rebuildInventoryProjectionForVariants(
      shopId,
      [variantId]
    );
  });

  if (!variantId) {
    return;
  }

  // 1️⃣ Find affected orders for this variant
  const affectedOrders = await db('order_revenue_units')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
    })
    .distinct('lasyncro_order_id');

  const orderIds: string[] = affectedOrders.map(
    (r: any) => r.lasyncro_order_id
  );

  // 2️⃣ Recompute obligations only if needed
  if (orderIds.length > 0) {
    await computeObligationFlagsForOrders(orderIds);
  }

}