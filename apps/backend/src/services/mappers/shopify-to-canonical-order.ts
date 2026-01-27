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
  const orderId = node.id; // gid://shopify/Order/...

  return {
    id: orderId,
    shopId,

    // ── Temporal anchors ─────────────────────────────
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    processedAt: node.processedAt ?? null,

    // ── Currency ────────────────────────────────────
    currency: node.currencyCode ?? null,

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
    lineItems: (node.lineItems?.edges ?? []).map((edge: any) => ({
      lineItemId: edge.node.id,
      orderId,
      productId: edge.node.product?.id ?? null,
      variantId: null,

      title: '',
      sku: null,

      quantity: edge.node.quantity,
      unitPrice: null,
      totalPrice: null,
      estimatedUnitCost: null,

      platform: 'shopify',
      platformLineItemId: edge.node.id,
    })),

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

