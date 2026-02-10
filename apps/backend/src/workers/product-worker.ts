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

  console.log('[AUDIT][RUNTIME_CONFLICT_KEYS]', [
    'shop_id',
    'platform',
    'platform_product_id',
    'platform_variant_id',
  ]);

  if (!rawProduct.id?.startsWith('gid://shopify/Product/')) {
    throw new Error(
      `[PRODUCT_INGESTION_INVALID] Unsupported product id: ${rawProduct.id}`
    );
  }

  const variantEdges = rawProduct?.variants?.edges;
  const hasVariants = Array.isArray(variantEdges) && variantEdges.length > 0;

  if (!hasVariants) {
    console.warn(
      '[product-worker][WARN] Product has no variants — product-only ingest',
      { productId: rawProduct.id }
    );
  };

  console.log('[product-worker][DEBUG] rawProduct keys', {
      id: rawProduct?.id,
      hasVariants: !!rawProduct?.variants,
      variantEdges: rawProduct?.variants?.edges?.length,
    });

  if (platform !== 'shopify') return;

  let canonicalProduct;
    try {
      canonicalProduct =
        productNormalizer.normalizeShopifyProduct(rawProduct, shopId);
    } catch (e) {
      console.error('[product-worker][NORMALIZATION_FAILED]', {
        shopId,
        productId: rawProduct?.id,
        error: (e as Error).message,
      });
      throw e;
    }

  const canonicalVariants =
    variantNormalizer.normalizeShopifyVariants(rawProduct, shopId);

  /* console.log('[product-worker] normalized product', {
    shopId,
    canonicalProductId: canonicalProduct.platformProductId,
    variantCount: canonicalVariants.length,
  }); */

  try {
   await db.transaction(async trx => {
    // Canonical product invariant:
    // - One row per (shop_id, platform, platform_product_id)
    // - platform_variant_id MUST be NULL for product-level rows

    console.log(
      '[AUDIT][CANONICAL_PRODUCT_BEFORE_INSERT]',
      canonicalProduct
    );
    
    // 1. Upsert canonical product
    await trx('canonical_products')
      .insert({
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

    const productRow = await trx('canonical_products')
      .select('canonical_product_id')
      .where({
        shop_id: canonicalProduct.shopId,
        platform: canonicalProduct.platform,
        platform_product_id: canonicalProduct.platformProductId,
      })
      .whereNull('platform_variant_id')
      .first();

    /**
     * Canonical Product Anchor
     * ------------------------
     * This numeric PK is the *only* valid anchor for:
     * - canonical_variants
     * - canonical_order_line_items
     *
     * Absence here is a HARD STOP.
     */
    if (!productRow || !productRow.canonical_product_id) {
      console.error(
        '[product-worker][FATAL] canonical product insert did not return PK',
        {
          shopId,
          platformProductId: canonicalProduct.platformProductId,
        }
      );
      throw new Error('[PRODUCT_INSERT_FAILED]');
    }

    const canonicalProductAnchorId = productRow.canonical_product_id;

    console.log('[product-worker][DEBUG] variants normalized', {
      shopId,
      count: canonicalVariants.length,
      sample: canonicalVariants[0],
    });

    // 2. Upsert canonical variants
    if (canonicalVariants.length > 0) {
      await trx('canonical_variants')
        .insert(
          canonicalVariants.map(v => ({
            shop_id: v.shop_id,
            canonical_variant_id: v.canonical_variant_id,
            canonical_product_id: v.canonical_product_id,
            canonical_product_anchor_id: canonicalProductAnchorId,
            sku: v.sku,
            title: v.title,
          }))
        )
        .onConflict(['shop_id', 'canonical_variant_id'])
        .merge({
          canonical_product_id: trx.raw('excluded.canonical_product_id'),
          canonical_product_anchor_id: trx.raw(
            'excluded.canonical_product_anchor_id'
          ),
          sku: trx.raw('excluded.sku'),
          title: trx.raw('excluded.title'),
          updated_at: trx.fn.now(),
        });
      }
    });

    // ✅ DURABLE SUCCESS SIGNAL — PRODUCT INGESTED
    try {
      await db('shop_ingestion_events')
        .insert({
          shop_id: shopId,
          module_id: 'product',
          event: 'ingested',
        })
        .onConflict(['shop_id', 'module_id', 'event'])
        .ignore();
    } catch (e) {
      // NON-FATAL: ingestion already committed
      console.error(
        '[product-worker][WARN] failed to record product ingestion success',
        { shopId, error: (e as Error).message }
      );
    }

    console.log('[product-worker] committed product + variants', {
      shopId,
      canonicalProductId: canonicalProduct.platformProductId,
    });
  } catch (error: any) {
  // NON-FATAL telemetry — never invalidate committed ingestion
  try {
    await db('shop_ingestion_events').insert({
      shop_id: msg.shopId,
      module_id: 'sku-os',
      event: 'product_ingestion_failed',
      metadata: JSON.stringify({
        error: error?.message ?? String(error),
        productId: msg.rawProduct?.id ?? null,
      }),
    });
  } catch {
    /* swallow */
  }

  console.error(
    '[AUDIT][PRODUCT_WORKER_TRANSACTION_FAILED]',
    error
  );
    // 🚫 DO NOT rethrow — product may already be committed
    return;
  }
}