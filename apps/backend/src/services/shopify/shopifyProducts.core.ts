import { Knex } from 'knex';

type DbExecutor = Knex | Knex.Transaction;

/**
 * mapShopifyProductType
 * ---------------------
 * Maps Shopify's free-text productType to canonical product_type values.
 *
 * Shopify productType is merchant-defined free text — not an enum.
 * We pattern-match known digital/gift/service types.
 * Everything else defaults to 'physical'.
 *
 * Canonical values:
 * - 'physical'   → requires warehouse picking, shipping, SKU
 * - 'digital'    → no warehouse ops, no SKU requirement
 * - 'gift_card'  → financial instrument, no warehouse ops
 * - 'service'    → subscription/plan, no physical fulfillment
 */
function mapShopifyProductType(productType: string | null | undefined): string {
  if (!productType) return 'physical';
  const t = productType.toLowerCase().trim();
  if (t === 'gift_card' || t === 'gift card' || t === 'giftcard') return 'gift_card';
  if (t === 'digital' || t === 'download' || t === 'e-book' || t === 'ebook') return 'digital';
  if (t === 'service' || t === 'subscription' || t === 'plan' || t === 'membership') return 'service';
  return 'physical';
}

/**
 * SHOPIFY PRODUCTS CORE
 * ---------------------
 * Low-level product persistence logic.
 *
 * Separated from orchestration to:
 * - prevent cross-service coupling
 * - avoid circular dependencies
 * - isolate DB logic
 */
export async function syncProducts(
  trx: DbExecutor,
  shopId: number,
  edges: any[]
) {
  for (const { node } of edges) {
    const productId = crypto.randomUUID();

    // 1. Insert product container
    await trx('products')
      .insert({
        lasyncro_product_id: productId,
        shop_id: shopId,
        title: node.title,
        status: node.status?.toLowerCase() || 'active',
        // product_type sourced from Shopify productType field.
        // Maps to canonical values: physical, digital, gift_card, service.
        // Defaults to 'physical' — most products are physical.
        product_type: mapShopifyProductType(node.productType),
        shopify_product_type_raw: node.productType ?? null,
      })
      .onConflict('lasyncro_product_id')
      .merge({
        // Update mutable fields on resync — title and type can change in Shopify
        title: node.title,
        status: node.status?.toLowerCase() || 'active',
        product_type: mapShopifyProductType(node.productType),
        shopify_product_type_raw: node.productType ?? null,
        updated_at: new Date().toISOString(),
      });

    const variantEdges = node.variants?.edges || [];

    for (const { node: variant } of variantEdges) {

      /**
       * CATALOG COST EXTRACTION
       * -----------------------
       * Shopify frequently omits variant cost.
       *
       * Ingestion must never fail because of missing cost.
       * Instead we record the variant with a placeholder
       * cost and allow the economics pipeline to detect
       * missing cost during reconciliation.
       * TODO: Capture the products with missing costs and prompt user
       * to fill in the missing costs!
       */
      const unitCostAmount = variant.inventoryItem?.unitCost?.amount;

      let unitCost = 0;

      if (!unitCostAmount) {
        console.warn(
          `[SHOPIFY_COST_MISSING] Variant ${variant.id} has no inventory cost`
        );
      } else {
        unitCost = Number(unitCostAmount);
      }
      const variantId = crypto.randomUUID();

      // 2. Insert variant (atomic unit)
      await trx('variants')
        .insert({
          lasyncro_variant_id: variantId,
          lasyncro_product_id: productId,
          shop_id: shopId,
          sku: variant.sku || null,
          title: variant.title,
          unit_cost: unitCost,
          status: 'active',
          // Global identifier (EAN/UPC/GTIN) from Shopify variant.barcode.
          // Drives receive flow branching — scan-to-match vs manual selection.
          barcode: variant.barcode || null,
        })
        .onConflict('lasyncro_variant_id')
        .merge({
          // Update mutable variant fields on resync
          sku: variant.sku || null,
          title: variant.title,
          unit_cost: unitCost,
          status: 'active',
          barcode: variant.barcode || null, // merchant may add EAN after initial sync
          updated_at: new Date().toISOString(),
        });

      // 3. Insert external identity mapping (variant-level)
      await trx('external_product_identity_map')
        .insert({
          id: crypto.randomUUID(),
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          platform: 'shopify',
          external_product_id: node.id,
          external_variant_id: variant.id,
          external_inventory_item_id: variant.inventoryItem?.id || null,
          external_sku: variant.sku || null,
          barcode: variant.barcode || null,
        })
        .onConflict([
          'shop_id',
          'platform',
          'external_product_id',
          'external_variant_id',
        ])
        .merge({
          /**
           * RESYNC UPDATE POLICY
           * --------------------
           * These fields may change in Shopify after initial sync:
           * - barcode: merchant adds/updates barcode on variant
           * - external_sku: merchant updates SKU
           * - external_inventory_item_id: platform internal update
           *
           * lasyncro_variant_id is NOT merged — it is immutable once assigned.
           */
          barcode: variant.barcode || null,
          external_sku: variant.sku || null,
          external_inventory_item_id: variant.inventoryItem?.id || null,
        });
    }
  }

  console.log(`[ShopifyService] Synced ${edges.length} products (variant-atomic).`);
};