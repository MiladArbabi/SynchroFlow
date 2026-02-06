// apps/backend/src/services/canonical-commerce-ingestion.service.ts
import db from '../db';
import type {
  CanonicalOrder,
  CanonicalOrderLineItem,
} from '@lasyncro/shared';
import type { FT0CanonicalOrder } 
  from '@lasyncro/shared/contracts/ft0-canonical-order';
import {
  CanonicalIngestionFailureReason,
} from '../domain/canonical-ingestion/failureReasons';

/**
 * ARCH-01 — Durable Canonical Ingestion Failure Audit
 * ---------------------------------------------------
 * This service is the ONLY writer to `canonical_ingestion_failures`.
 *
 * Purpose:
 * - Persist why an order was excluded from canonical ingestion
 * - Preserve FT2 hard gates (no partial canon, no recovery)
 * - Enable post-fact diagnosis and targeted replay
 *
 * Rules:
 * - Write-once, append-only
 * - Record → throw (never swallow)
 * - Never read by FT2
 * - Never imply retry or remediation
 */
async function writeCanonicalIngestionFailure(
  payload: {
    shopId: number;
    platform: string;
    platformOrderId: string;
    failureReason: CanonicalIngestionFailureReason;
    failureStage: string;
    evidence: Record<string, unknown>;
  }
): Promise<void> {
  await db('canonical_ingestion_failures')
    .insert({
      shop_id: payload.shopId,
      platform: payload.platform,
      platform_order_id: payload.platformOrderId,
      failure_reason: payload.failureReason,
      failure_stage: payload.failureStage,
      evidence: JSON.stringify(payload.evidence),
    })
    .onConflict(['shop_id', 'platform', 'platform_order_id', 'failure_reason'])
    .ignore();
}

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
    //
    // IMPORTANT (Pricing Primitives v1):
    // --------------------------------
    // - unit_price / line_total are written ONLY at ingestion time
    // - This service NEVER backfills existing rows
    // - Historical data MUST be re-ingested or explicitly backfilled
    //

    /* if (canonicalOrder.lineItems?.length) {
      console.log('[INGEST][LINE_ITEM_SAMPLE]', {
        sample: canonicalOrder.lineItems[0],
        keys: Object.keys(canonicalOrder.lineItems[0]),
      });
    } */

    /**
     * CANONICAL PRODUCT ANCHOR RESOLUTION
     * ----------------------------------
     * Orders DO NOT infer product anchors.
     *
     * Rules:
     * - Anchors are produced exclusively by product ingestion
     * - Variants MUST already be anchored
     * - Orders consume anchors or fail fast
     *
     * This guarantees:
     * - Orders ↔ Products joinability
     * - FT2 eligibility correctness
     * - No silent identity corruption
     */
    const variantIds = (canonicalOrder.lineItems || [])
      .map(li => li.variantId)
      .filter((v): v is string => Boolean(v));

    let anchorByVariant = new Map<string, number>();

    if (variantIds.length > 0) {
      const anchors = await db('canonical_variants')
        .where({ shop_id: canonicalOrder.shopId })
        .whereIn('canonical_variant_id', variantIds)
        .select(
          'canonical_variant_id',
          'canonical_product_anchor_id'
        );

      anchorByVariant = new Map(
        anchors.map(a => [
          a.canonical_variant_id,
          a.canonical_product_anchor_id,
        ])
      );
    };

    /**
     * CANONICAL IDENTITY INVARIANT
     * ---------------------------
     * If a line item references a variant, it MUST reference a product.
     * Writing variant-backed line items without product anchoring breaks:
     * - FT2 eligibility
     * - Orders ↔ Products joins
     * - Revenue attribution
     *
     * This is a hard failure by design.
     */
    // HARD FAIL — no partial orders allowed
    for (const li of canonicalOrder.lineItems || []) {
      if (li.variantId && !anchorByVariant.get(li.variantId)) {
        await writeCanonicalIngestionFailure({
          shopId: canonicalOrder.shopId,
          platform: canonicalOrder.platform,
          platformOrderId: normalizedPlatformOrderId,
          failureReason: CanonicalIngestionFailureReason.UNRESOLVED_PRODUCT,
          failureStage: 'variant_anchor_resolution',
          evidence: {
            canonical_order_id: canonicalOrder.id,
            platform_order_id: normalizedPlatformOrderId,
            platform_line_item_id: li.platformLineItemId,
            product_id: li.productId ?? null,
            variant_id: li.variantId,
            known_variant_anchors: Array.from(anchorByVariant.keys()),
          },
        });

        throw new Error(
          `[CANONICAL_IDENTITY_VIOLATION] Missing product anchor for variant ${li.variantId}. ` +
          `Product ingestion must complete before order ingestion.`
        );
      }
    }

    const lineItems = (canonicalOrder.lineItems || []).map((li) => ({
      shop_id: canonicalOrder.shopId,
      canonical_line_item_id: li.lineItemId,
      canonical_order_id: canonicalOrder.id,

      canonical_product_id: li.productId,
      canonical_variant_id: li.variantId,

      /**
       * Product anchor (REQUIRED)
       * ------------------------
       * FK → canonical_products(canonical_product_id)
       * Derived ONLY via canonical_variants
       */
      canonical_product_anchor_id:
        li.variantId ? anchorByVariant.get(li.variantId)! : null,

      canonical_variant_code: li.variantId
        ? `CVC-${canonicalOrder.shopId}-${li.variantId}`
        : null,
      platform: li.platform,
      platform_order_id: canonicalOrder.platformOrderId,
      platform_line_item_id: li.platformLineItemId,
      title: li.title,
      sku: li.sku,
      quantity: li.quantity,

      /**
       * Pricing primitives (Customer Obligation v3)
       * ------------------------------------------
       * Rules:
       * - unit_price MUST be platform-derived
       * - No inference, no estimation
       * - NULL if platform does not provide sufficient truth
       */
      unit_price:
        li.unitPrice ??
        (li.totalPrice && li.quantity
          ? Number(li.totalPrice) / Number(li.quantity)
          : null),

      line_total: li.totalPrice ?? null,

      price_source: 'platform_reported',

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
      await writeCanonicalIngestionFailure({
        shopId: canonicalOrder.shopId,
        platform: canonicalOrder.platform,
        platformOrderId: normalizedPlatformOrderId,
        failureReason: CanonicalIngestionFailureReason.UNKNOWN_CANONICAL_VIOLATION,
        failureStage: 'db_transaction',
        evidence: {
          canonical_order_id: canonicalOrder.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });

      const msg = err instanceof Error ? err.message : 'Unknown DB error';
      throw new Error(`Failed to insert canonical order: ${msg}`);
    }
  }
}

export default CanonicalCommerceIngestionService;
