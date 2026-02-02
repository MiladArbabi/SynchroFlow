// apps/backend/src/workers/product-worker.ts
import db from '../db';
import { ProductNormalizationService } from '../services/product-normalization.service';
import { VariantNormalizationService } from '../services/variant-normalization.service';
import { CanonicalProductInput, CanonicalProductStatus } from '@lasyncro/shared';

export interface ProductIngestionMessage {
  shopId: number;
  platform: 'shopify';
  rawProduct: any;
}

const productNormalizer = new ProductNormalizationService();
const variantNormalizer = new VariantNormalizationService();

/**
 * FT0 status projection
 * --------------------
 * CanonicalProductStatus → FT0-safe enum
 */
function projectCanonicalStatusToFt0(
  status: CanonicalProductStatus
): 'active' | 'inactive' | 'archived' {
  switch (status) {
    case 'active':
      return 'active';
    case 'archived':
      return 'archived';
    case 'draft':
    case 'unknown':
    default:
      return 'inactive';
  }
}

export async function processProductMessage(
  msg: ProductIngestionMessage
): Promise<void> {
  const { shopId, platform, rawProduct } = msg;

  if (platform !== 'shopify') return;

  const canonicalProduct =
    productNormalizer.normalizeShopifyProduct(rawProduct, shopId);

  const canonicalVariants =
    variantNormalizer.normalizeShopifyVariants(rawProduct, shopId);

  console.log('[product-worker] normalized product', {
    shopId,
    canonicalProductId: canonicalProduct.platformProductId,
    variantCount: canonicalVariants.length,
  });

  await db.transaction(async trx => {
    // Canonical product invariant:
    // - One row per (shop_id, platform, platform_product_id)
    // - platform_variant_id MUST be NULL for product-level rows

    // 1. Upsert canonical product
    await trx('canonical_products')
      .insert({
        // canonical_product_id is DB-assigned (SERIAL PRIMARY KEY)
        shop_id: canonicalProduct.shopId,
        platform: canonicalProduct.platform,
        platform_product_id: canonicalProduct.platformProductId,
        platform_variant_id: null,
        sku: canonicalProduct.sku,
        title: canonicalProduct.title,
        status: projectCanonicalStatusToFt0(canonicalProduct.status),
        created_at: canonicalProduct.createdAt,
        updated_at: canonicalProduct.updatedAt,
      })

      /**
       * Canonical product identity
       * -------------------------
       * Product-level rows MUST NOT include platform_variant_id
       * because NULLs do not participate in Postgres UNIQUE constraints.
       *
       * Identity: (shop_id, platform, platform_product_id)
       */
      .onConflict([
        'shop_id',
        'platform',
        'platform_product_id',
        'platform_variant_id',
      ])
      .merge({
        sku: canonicalProduct.sku,
        title: canonicalProduct.title,
        status: projectCanonicalStatusToFt0(canonicalProduct.status),
        updated_at: canonicalProduct.updatedAt,
      });

    // 2. Upsert canonical variants
    if (canonicalVariants.length > 0) {
      await trx('canonical_variants')
        .insert(
          canonicalVariants.map(v => ({
            shop_id: v.shop_id,
            canonical_variant_id: v.canonical_variant_id,

            // IMPORTANT:
            // canonical_product_id here is the PLATFORM product GID,
            // NOT the numeric canonical_products PK.
            //
            // This is intentional: canonical_variants bridges
            // canonical_order_line_items → platform product identity.
            canonical_product_id: v.canonical_product_id,

            sku: v.sku,
            title: v.title,
          }))
        )
        .onConflict(['shop_id', 'canonical_variant_id'])
        .merge({
          canonical_product_id: trx.raw('excluded.canonical_product_id'),
          sku: trx.raw('excluded.sku'),
          title: trx.raw('excluded.title'),
          updated_at: trx.fn.now(),
        });
    }

    // 3. SKU-OS ingestion signal (monotonic)
    await trx('shop_ingestion_events')
      .insert({
        shop_id: shopId,
        module_id: 'sku-os',
        event: 'product_ingested',
      })
      .onConflict(['shop_id', 'module_id', 'event'])
      .ignore();
  });

  console.log('[product-worker] committed product + variants', {
    shopId,
    canonicalProductId: canonicalProduct.platformProductId,
  });

}