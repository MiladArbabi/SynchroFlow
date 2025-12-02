// apps/backend/src/services/canonical-commerce-ingestion.service.ts
import db from '../db';
import {
  CanonicalOrder,
  CanonicalOrderLineItem,
} from '@synchroflow/shared/contracts/canonical-commerce';


export class CanonicalCommerceIngestionService {
  /**
   * Persist a CanonicalOrder + its line items into canonical_* tables.
   *
   * FT0 scope:
   * - One-row insert into canonical_orders
   * - N-row insert into canonical_order_line_items
   * - No upsert/recompute yet (backfill only)
   */
  async insertCanonicalOrder(order: CanonicalOrder): Promise<void> {
    // In FT0, keep it simple: no explicit transaction / retry.
    // If you want, you can wrap with db.transaction later.
    const orderRow = {
      shop_id: order.shopId,
      canonical_order_id: order.id,
      platform: order.platform,
      platform_order_id: order.platformOrderId,
      currency: order.currency,
      total_price: order.totalPrice,
      subtotal_price: order.subtotalPrice,
      total_tax: order.totalTax,
      source: order.source ?? null,
      referrer_medium: order.referrerMedium ?? null,
      customer_hashed_id: order.customer?.hashedId ?? null,
      order_created_at: order.createdAt,
      order_updated_at: order.updatedAt,
      order_processed_at: order.processedAt ?? null,
    };

    await db('canonical_orders').insert(orderRow);

    if (order.lineItems && order.lineItems.length > 0) {
      const lineRows = order.lineItems.map((li: CanonicalOrderLineItem) => ({
        shop_id: order.shopId,
        canonical_line_item_id: li.lineItemId,
        canonical_order_id: order.id,
        canonical_product_id: li.productId ?? null,
        canonical_variant_id: li.variantId ?? null,
        platform: li.platform,
        platform_order_id: order.platformOrderId,
        platform_line_item_id: li.platformLineItemId ?? null,
        title: li.title,
        sku: li.sku ?? null,
        quantity: li.quantity,
        unit_price: li.unitPrice,
        total_price: li.totalPrice,
        estimated_unit_cost: li.estimatedUnitCost ?? null,
      }));

      await db('canonical_order_line_items').insert(lineRows);
    }
  }
}
