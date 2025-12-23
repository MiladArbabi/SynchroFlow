//apps/backend/src/services/mappers/shopify-to-canonical-order.ts

import type { FT0CanonicalOrder } 
  from '@lasyncro/shared/contracts/ft0-canonical-order';

export function mapShopifyOrderNodeToCanonical(
  node: any,
  shopId: number
): FT0CanonicalOrder {
  const orderId = node.id; // gid://shopify/Order/...

  return {
    id: orderId,
    shopId,

    createdAt: node.createdAt,
    updatedAt: node.createdAt,
    processedAt: node.createdAt,

    currency: node.currencyCode,

    totalPrice: Number(node.totalPriceSet?.shopMoney?.amount ?? 0),
    subtotalPrice: Number(node.totalPriceSet?.shopMoney?.amount ?? 0),
    totalTax: 0,

    shippingLines: [],

    lineItems: (node.lineItems?.edges ?? []).map((edge: any) => ({
      lineItemId: edge.node.id,
      orderId,
      productId: edge.node.product?.id ?? null,
      variantId: null,

      title: '',
      sku: null,

      quantity: edge.node.quantity,
      unitPrice: 0,
      totalPrice: 0,
      estimatedUnitCost: null,

      platform: 'shopify',
      platformLineItemId: edge.node.id,
    })),

    customer: undefined,

    source: node.sourceName ?? null,
    referrerMedium: null,

    platform: 'shopify',
    platformOrderId: orderId,
  };
}
