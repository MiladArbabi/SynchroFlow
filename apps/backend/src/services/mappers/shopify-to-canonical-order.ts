//apps/backend/src/services/mappers/shopify-to-canonical-order.ts
import { createHash } from 'crypto';
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

  const currency =
    node.currencyCode ??
    node.currency ??
    node.presentment_currency ??
    node.total_price_set?.shop_money?.currency_code ??
    node.current_total_price_set?.shop_money?.currency_code ??
    null;

  if (!currency) {
    console.error('[CANONICAL_ORDER][CURRENCY_MISSING]', {
      shopifyOrderId: node.id,
      raw: node,
    });

    throw new Error('[CANONICAL_ORDER] currencyCode is required');
  }

  const totalPriceRaw =
    node.totalPriceSet?.shopMoney?.amount ??
    node.total_price_set?.shop_money?.amount ??
    node.current_total_price_set?.shop_money?.amount ??
    node.total_price ??
    node.current_total_price ??
    null;

  if (totalPriceRaw == null) {
    throw new Error('[CANONICAL_ORDER] totalPrice missing');
  }

  const totalPrice = Number(totalPriceRaw);

  const subtotalRaw =
    node.subtotalPriceSet?.shopMoney?.amount ??
    node.subtotal_price_set?.shop_money?.amount ??
    node.current_subtotal_price_set?.shop_money?.amount ??
    node.subtotal_price ??
    node.current_subtotal_price ??
    null;

  if (subtotalRaw == null) {
    throw new Error('[CANONICAL_ORDER] subtotalPrice missing');
  }

  const subtotalPrice = Number(subtotalRaw);

  const totalTaxRaw =
    node.totalTaxSet?.shopMoney?.amount ??
    node.total_tax_set?.shop_money?.amount ??
    node.current_total_tax_set?.shop_money?.amount ??
    node.total_tax ??
    node.current_total_tax ??
    null;

  if (totalTaxRaw == null) {
    throw new Error('[CANONICAL_ORDER] totalTax missing');
  }

  const totalTax = Number(totalTaxRaw);

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
    totalPrice,

    subtotalPrice,
    totalTax,

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

        title: li.variant?.title ?? li.title ?? '',
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
    /**
     * CUSTOMER IDENTITY
     * -----------------------------------
     * Extract Shopify customer GID and hash it deterministically.
     * SHA256(shopId:customerId) — anonymous, non-reversible.
     * Null for guest checkouts (no customer attached to order).
     *
     * Uses synchronous createHash — safe in mapper context.
     */
    customer: (() => {
      const customerId = node.customer?.id;
      if (!customerId) return undefined;
      // createHash imported at top of file
      const raw = String(customerId).replace('gid://shopify/Customer/', '');
      const hashed = createHash('sha256')
        .update(`${shopId}:${raw}`)
        .digest('hex');
      return { hashedId: hashed, customerType: 'registered' as const };
    })(),
    source: node.sourceName ?? null,
    referrerMedium: null,

    // ── Platform identity ───────────────────────────
    platform: 'shopify',
    platformOrderId: orderId, // normalized later in ingestion
  };
}