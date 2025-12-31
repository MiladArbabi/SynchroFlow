// apps/backend/src/workers/product-worker.ts

import db from '../db';
import { ProductNormalizationService } from '../services/product-normalization.service';
import { CanonicalProductInput, CanonicalProductStatus } from '@lasyncro/shared';

export interface ProductIngestionMessage {
  shopId: number;
  platform: 'shopify';
  rawProduct: any;
}

const normalizer = new ProductNormalizationService();

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

export async function processProductMessage(msg: ProductIngestionMessage): Promise<void> {
  console.log('[product-worker] processProductMessage called', {
    shopId: msg.shopId,
    platform: msg.platform,
  });

  const dbName = await db.raw('select current_database()');
  console.log('[product-worker][debug] db =', dbName.rows?.[0]?.current_database);

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
      status: projectCanonicalStatusToFt0(canonicalInput.status),
      created_at: canonicalInput.createdAt,
      updated_at: canonicalInput.updatedAt,
    })
    .onConflict(['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'])
    .merge({
      sku: canonicalInput.sku ?? null,
      title: canonicalInput.title,
      status: projectCanonicalStatusToFt0(canonicalInput.status),
      updated_at: canonicalInput.updatedAt,
    });

    // Mark SKU-OS ingestion as having occurred for this shop
  // This is a monotonic signal: once true, always true
  await db('shop_ingestion_events')
    .insert({
      shop_id: shopId,
      module_id: 'sku-os',
      event: 'product_ingested',
    })
    .onConflict(['shop_id', 'module_id', 'event'])
    .ignore();
}
