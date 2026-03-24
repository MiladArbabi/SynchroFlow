//apps/backend/src/services/mappers/shopify-to-canonical-order.ts

import type { FT0CanonicalOrder } 
  from '@lasyncro/shared/contracts/ft0-canonical-order';

/**
 * Shopify → Canonical Order Mapper (FT0 / FT2 compliant)
 * -----------------------------------------------------
 * Invariants:
 * - No fabricated values
 * - All monetary fields must come from Shopify sets
 * - Temporal fields must reflect actual Shopify timestamps
 * - Missing fields remain null (never defaulted)
 */

export function mapShopifyOrderNodeToCanonical(
  node: any,
  shopId: number
): FT0CanonicalOrder {
  const rawId = node.id ?? node.order_id;

    if (!rawId) {
      console.error('[CANONICAL_ORDER_ID_MISSING]', {
        shopId,
        node,
      });
      throw new Error('[CANONICAL_ORDER_ID_MISSING]');
    }

    let orderId = String(rawId);

    if (orderId.startsWith('gid://')) {
      const parts = orderId.split('/');
      orderId = parts[parts.length - 1];
    }

    /**
     * CRITICAL INVARIANT
     * ------------------
     * Canonical layer MUST emit normalized numeric ID.
     */
    if (!/^\d+$/.test(orderId)) {
      throw new Error('[CANONICAL_ORDER_INVALID_ID]');
    }

  const currency = node.currencyCode;

  if (!currency) {
    console.error('[CANONICAL_ORDER][CURRENCY_MISSING]', {
      shopifyOrderId: node.id,
      raw: node,
    });

    throw new Error('[CANONICAL_ORDER] currencyCode is required');
  }

  if (node.totalPriceSet?.shopMoney?.amount == null) {
    throw new Error('[CANONICAL_ORDER] totalPrice missing');
  }

  return {
    id: orderId,
    shopId,

    // ── Temporal anchors ─────────────────────────────
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    processedAt: node.processedAt ?? null,

    // ── Currency ────────────────────────────────────
    currency,

    // ── Monetary completeness (NO inference) ─────────
    totalPrice:
      node.totalPriceSet?.shopMoney?.amount != null
        ? Number(node.totalPriceSet.shopMoney.amount)
        : null,

    subtotalPrice:
      node.subtotalPriceSet?.shopMoney?.amount != null
        ? Number(node.subtotalPriceSet.shopMoney.amount)
        : null,

    totalTax:
      node.totalTaxSet?.shopMoney?.amount != null
        ? Number(node.totalTaxSet.shopMoney.amount)
        : null,

    // ── Line items (structural only) ─────────────────
    lineItems: (node.lineItems?.edges ?? []).map((edge: any) => {
      const li = edge.node;

      const unitPrice =
        li.discountedUnitPriceSet?.shopMoney?.amount != null
          ? Number(li.discountedUnitPriceSet.shopMoney.amount)
          : li.originalUnitPriceSet?.shopMoney?.amount != null
            ? Number(li.originalUnitPriceSet.shopMoney.amount)
            : null;

      const totalPrice =
        li.originalTotalSet?.shopMoney?.amount != null
          ? Number(li.originalTotalSet.shopMoney.amount)
          : li.discountedTotalSet?.shopMoney?.amount != null
            ? Number(li.discountedTotalSet.shopMoney.amount)
            : null;

      return {
        lineItemId: li.id,
        orderId,
        productId: li.product?.id ?? null,

        // 🔑 Identity (explicit, no synthesis)
        variantId: li.variant?.id ?? null,

        title: li.title ?? '',
        sku: li.sku ?? li.variant?.sku ?? null,

        quantity: li.quantity,

        // 💰 Pricing primitives (platform-reported only)
        unitPrice,
        totalPrice,

        estimatedUnitCost: null,

        platform: 'shopify',
        platformLineItemId: li.id,
      };
    }),


    // ── Optional / absent signals ───────────────────
    shippingLines: [],
    customer: undefined,
    source: node.sourceName ?? null,
    referrerMedium: null,

    // ── Platform identity ───────────────────────────
    platform: 'shopify',
    platformOrderId: orderId, // normalized later in ingestion
  };
}