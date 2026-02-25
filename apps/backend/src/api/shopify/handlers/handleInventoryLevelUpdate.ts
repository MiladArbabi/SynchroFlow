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
    console.log('[inventory_sync] missing shopId', {
      eventId: envelope.eventId,
    });
    return;
  }
  
  let externalInventoryItemGid: string | null = null;

  if (payload.admin_graphql_api_id) {
    externalInventoryItemGid = payload.admin_graphql_api_id;
  } else if (payload.inventory_item_id) {
    externalInventoryItemGid =
      `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  }

  if (!externalInventoryItemGid) {
    console.warn('[inventory_sync] missing inventory item id', {
      eventId: envelope.eventId,
      payload,
    });
    return;
  }

    let variantId: string | null = null;

    await db.transaction(async (trx) => {

    const mapping = await trx('external_product_identity_map')
      .where({
        shop_id: shopId,
        external_inventory_item_id: String(externalInventoryItemGid),
      })
      .first();

    if (!mapping) {
      console.warn('[inventory_sync] mapping not found', {
        shopId,
        externalInventoryItemGid,
      });
      return;
    }

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

    if (delta === 0) {
      console.info('[inventory_sync] no delta detected', {
        shopId,
        variantId,
        available,
        projectedQty,
      });
      return;
    }

    /**
     * ORDER-SCOPED OBLIGATION RECOMPUTE
     * ----------------------------------
     * Must occur inside same transaction as:
     * - movement insert
     * - projection rebuild
     *
     * Prevents projection/obligation drift.
     */
    const affectedOrders = await trx('order_revenue_units as ru')
      .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
      .where({
        'ru.lasyncro_variant_id': variantId,
        'o.shop_id': shopId,
      })
      .distinct('ru.lasyncro_order_id');

    const orderIds: string[] = affectedOrders.map(
      (r: any) => r.lasyncro_order_id
    );

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
      [variantId],
      trx
    );

    if (orderIds.length > 0) {
      await computeObligationFlagsForOrders(orderIds, trx);
    }
  });
}