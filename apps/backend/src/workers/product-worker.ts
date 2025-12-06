// apps/backend/src/workers/product-worker.ts

import db from '../db';
import { ProductNormalizationService } from '../services/product-normalization.service';
import { CanonicalProductInput } from '@lasyncro/shared';

export interface ProductIngestionMessage {
  shopId: number;
  platform: 'shopify';
  rawProduct: any;
}

const normalizer = new ProductNormalizationService();

export async function processProductMessage(msg: ProductIngestionMessage): Promise<void> {
  const { shopId, platform, rawProduct } = msg;

  if (platform !== 'shopify') {
    // FT0 only supports Shopify; silently ignore others for now
    return;
  }

  const canonicalInput: CanonicalProductInput = 
    normalizer.normalizeShopifyProduct(rawProduct, shopId);

  // Upsert into canonical_products using identity (shop, platform, product, variant)
  await db('canonical_products')
    .insert({
      shop_id: canonicalInput.shopId,
      platform: canonicalInput.platform,
      platform_product_id: canonicalInput.platformProductId,
      platform_variant_id: canonicalInput.platformVariantId ?? null,
      sku: canonicalInput.sku ?? null,
      title: canonicalInput.title,
      status: canonicalInput.status ?? 'active',
      created_at: canonicalInput.createdAt,
      updated_at: canonicalInput.updatedAt,
    })
    .onConflict(['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'])
    .merge({
      sku: canonicalInput.sku ?? null,
      title: canonicalInput.title,
      status: canonicalInput.status ?? 'active',
      updated_at: canonicalInput.updatedAt,
    });
}
