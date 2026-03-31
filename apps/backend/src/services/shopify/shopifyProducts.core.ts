import { Knex } from 'knex';

type DbExecutor = Knex | Knex.Transaction;

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
      })
      .onConflict('lasyncro_product_id')
      .ignore()
      .then((res) => {
        if (!res || res.length === 0) {
          console.debug('[INGESTION_DUPLICATE_SKIPPED]', {
            entity: 'product',
            conflictKey: 'lasyncro_product_id'
          });
        }
        return res;
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
        })
        .onConflict('lasyncro_variant_id')
        .ignore()
        .then((res) => {
          if (!res || res.length === 0) {
            console.debug('[INGESTION_DUPLICATE_SKIPPED]', {
              entity: 'variant',
              conflictKey: 'lasyncro_variant_id'
            });
          }
          return res;
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
        })
        .onConflict([
          'shop_id',
          'platform',
          'external_product_id',
          'external_variant_id',
        ])
        .ignore()
        .then((res) => {
          if (!res || res.length === 0) {
            console.debug('[INGESTION_DUPLICATE_SKIPPED]', {
              entity: 'external_product_identity_map',
              conflictKey: ['shop_id', 'platform', 'external_product_id', 'external_variant_id']
            });
          }
          return res;
        });
    }
  }

  console.log(`[ShopifyService] Synced ${edges.length} products (variant-atomic).`);
};