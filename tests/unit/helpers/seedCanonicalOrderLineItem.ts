// tests/unit/helpers/seedCanonicalOrderLineItem.ts
import db from '@lasyncro/backend-core/db.js';

type SeedCanonicalOrderLineItemInput = {
  shopId: number;
  canonicalOrderId: string;
  canonicalLineItemId?: string;
  estimatedUnitCost?: number | null;
};

export async function seedCanonicalOrderLineItem({
  shopId,
  canonicalOrderId,
  canonicalLineItemId = 'line-item-001',
  estimatedUnitCost = null,
}: SeedCanonicalOrderLineItemInput) {
  await db('canonical_order_line_items').insert({
    shop_id: shopId,

    canonical_line_item_id: canonicalLineItemId,
    canonical_order_id: canonicalOrderId,

    platform: 'shopify',
    platform_order_id: `platform-${canonicalOrderId}`,
    platform_line_item_id: `platform-${canonicalLineItemId}`,

    title: 'Test Product',
    sku: 'TEST-SKU',

    quantity: 1,
    unit_price: 100,
    total_price: 100,

    estimated_unit_cost: estimatedUnitCost,
  });
}
