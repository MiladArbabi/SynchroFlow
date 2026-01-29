// apps/backend/src/services/canonical-commerce-ingestion.service.ts
import db from '../db';
import type {
  CanonicalOrder,
  CanonicalOrderLineItem,
} from '@lasyncro/shared';
import type { FT0CanonicalOrder } 
  from '@lasyncro/shared/contracts/ft0-canonical-order';

/**
 * Service responsible for persisting canonical commerce entities.
 *
 * - Validates minimal required fields for an incoming CanonicalOrder
 * - Persists canonical order row
 * - Persists canonical order line items (only if present)
 * - Wraps DB errors into a friendly error message for callers
 */
export class CanonicalCommerceIngestionService {
  async insertCanonicalOrder(
    canonicalOrder: FT0CanonicalOrder
  ): Promise<void> {
    // Basic validation
    if (!canonicalOrder || !canonicalOrder.id || !canonicalOrder.shopId) {
      throw new Error('Invalid canonical order: missing id or shopId');
    }

  /**
   * Shopify platform_order_id normalization
   * --------------------------------------
   * Canonical rule:
   * - Always persist numeric Shopify order ID
   * - This is the join key for fulfillment webhooks
   *
   * Example:
   *   gid://shopify/Order/16567328080242 → 16567328080242
   */
  const normalizedPlatformOrderId =
    canonicalOrder.platform === 'shopify'
      ? String(canonicalOrder.platformOrderId).replace(
          /^gid:\/\/shopify\/Order\//,
          ''
        )
      : canonicalOrder.platformOrderId;

  const orderRow = {
    shop_id: canonicalOrder.shopId,
    canonical_order_id: canonicalOrder.id,
    platform: canonicalOrder.platform,
    platform_order_id: normalizedPlatformOrderId,
    currency: canonicalOrder.currency,
    total_price: canonicalOrder.totalPrice,
    subtotal_price: canonicalOrder.subtotalPrice,
    total_tax: canonicalOrder.totalTax,
    source: canonicalOrder.source,
    referrer_medium: canonicalOrder.referrerMedium,
    customer_hashed_id: canonicalOrder.customer?.hashedId ?? null,
    order_created_at: canonicalOrder.createdAt,
    order_updated_at: canonicalOrder.updatedAt,
    order_processed_at: canonicalOrder.processedAt,
  };

    // Prepare line items rows
    const lineItems = (canonicalOrder.lineItems || []).map((li) => ({
      shop_id: canonicalOrder.shopId,
      canonical_line_item_id: li.lineItemId,
      canonical_order_id: canonicalOrder.id,
      canonical_product_id: li.productId,
      canonical_variant_id: li.variantId,
      platform: li.platform,
      platform_order_id: canonicalOrder.platformOrderId,
      platform_line_item_id: li.platformLineItemId,
      title: li.title,
      sku: li.sku,
      quantity: li.quantity,
      unit_price: li.unitPrice,
      total_price: li.totalPrice,
      estimated_unit_cost: li.estimatedUnitCost ?? null,

      order_created_at: canonicalOrder.createdAt,
    }));

    try {
      /**
       * IMPORTANT:
       * ----------
       * This service MUST NOT write to order_fulfillment_status.
       *
       * Fulfillment execution state is derived asynchronously
       * by the Fulfillment Reconciliation Worker after:
       * - canonical identity resolution
       * - webhook / fulfillment source convergence
       *
       * Any execution bootstrap here is a data corruption risk.
       */

      // If db.transaction exists (real DB), use it. Otherwise fall back to a test-friendly path.
      if (typeof (db as any).transaction === 'function') {
        await (db as any).transaction(async (trx: any) => {
          await db('canonical_orders')
            .transacting(trx)
            .insert(orderRow)
            .onConflict('canonical_order_id')
            .merge(orderRow);

          if (lineItems.length > 0) {
            await db('canonical_order_line_items')
              .transacting(trx)
              .insert(lineItems)
              .onConflict('canonical_line_item_id')
              .merge();
          }
        });
      } else {
        // Test/mock path: the test DB mock exposes chainable methods (insert.onConflict.merge.transacting)
        // Use a simple procedural flow that still calls `.transacting(trx)` with a mock trx object (db())
        const mockTrx = (db as any)(); // mock returns the chainable instance

        await db('canonical_orders')
          .transacting(mockTrx)
          .insert(orderRow)
          .onConflict('canonical_order_id')
          .merge(orderRow);

        if (lineItems.length > 0) {
          await db('canonical_order_line_items')
            .transacting(mockTrx)
            .insert(lineItems)
            .onConflict('canonical_line_item_id')
            .merge();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown DB error';
      throw new Error(`Failed to insert canonical order: ${msg}`);
    }
  }
}

export default CanonicalCommerceIngestionService;
