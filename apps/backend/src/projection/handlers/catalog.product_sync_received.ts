// apps/backend/src/projection/handlers/catalog.product_sync_received.ts

/**
 * CATALOG — PRODUCT SYNC RECEIVED PROJECTION HANDLER
 * ---------------------------------------------------
 * Projects mutable product fields from re-sync events.
 *
 * IMPORTANT ARCHITECTURAL NOTE:
 * Initial product writes (products, variants, external_product_identity_map)
 * are performed synchronously in shopifyProducts.core.ts at sync time.
 *
 * This handler covers the subsequent case:
 * A merchant updates title, status, or product_type in Shopify after
 * initial sync — the re-sync event carries updated fields that must
 * be reflected in the sovereign products table.
 *
 * Identity resolution:
 *   event_payload.id (Shopify numeric product ID)
 *   → external_product_identity_map.external_product_id
 *   → products.lasyncro_product_id
 *
 * No-op conditions (logged, not thrown):
 * - Product not found in identity map → sync order issue, safe to skip
 * - Missing payload fields → partial payload, skip gracefully
 */

import { Knex } from 'knex';

function mapShopifyStatus(status: string | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
    case 'active_online': return 'active';
    case 'archived':      return 'archived';
    case 'draft':         return 'draft';
    default:              return 'unknown';
  }
}

function mapShopifyProductType(productType: string | null | undefined): string {
  if (!productType) return 'physical';
  const t = productType.toLowerCase().trim();
  if (t === 'gift_card' || t === 'gift card' || t === 'giftcard') return 'gift_card';
  if (t === 'digital' || t === 'download' || t === 'e-book' || t === 'ebook') return 'digital';
  if (t === 'service' || t === 'subscription' || t === 'plan' || t === 'membership') return 'service';
  return 'physical';
}

export async function handleCatalogProductSyncReceived({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}): Promise<void> {
  const payload = domainEvent.event_payload as any;
  const shopId = domainEvent.shop_id as number;

  if (!payload?.id) {
    console.warn('[PROJECTION_CATALOG_SKIP_NO_ID]', { eventId: domain_event_id });
    return;
  }

  // Normalize external product ID — strip GID if present
  const externalProductId = String(payload.id).startsWith('gid://')
    ? String(payload.id)
    : `gid://shopify/Product/${payload.id}`;

  // Resolve internal product ID via identity map
  const identityRow = await trx('external_product_identity_map')
    .where({ shop_id: shopId, external_product_id: externalProductId })
    .select('lasyncro_product_id')
    .first();

  if (!identityRow?.lasyncro_product_id) {
    // Product not yet in identity map — sync order issue, safe to skip.
    // Will be written correctly on next full sync.
    console.warn('[PROJECTION_CATALOG_SKIP_NO_IDENTITY]', {
      eventId: domain_event_id,
      externalProductId,
      shopId,
    });
    return;
  }

  // Update mutable product fields — title, status, product_type may change post-sync
  const updated = await trx('products')
    .where({
      lasyncro_product_id: identityRow.lasyncro_product_id,
      shop_id: shopId,
    })
    .update({
      title:                   payload.title ?? trx.raw('title'),
      status:                  mapShopifyStatus(payload.status),
      product_type:            mapShopifyProductType(payload.product_type ?? payload.productType),
      shopify_product_type_raw: payload.product_type ?? payload.productType ?? null,
      updated_at:              canonicalEventTime,
    });

  if (updated === 0) {
    console.warn('[PROJECTION_CATALOG_PRODUCT_NOT_FOUND]', {
      eventId: domain_event_id,
      lasyncroProductId: identityRow.lasyncro_product_id,
      shopId,
    });
    return;
  }

  console.info('[PROJECTION_CATALOG_PRODUCT_UPDATED]', {
    eventId: domain_event_id,
    lasyncroProductId: identityRow.lasyncro_product_id,
    shopId,
  });
}