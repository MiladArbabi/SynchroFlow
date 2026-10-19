// apps/backend/src/api/shopify/handlers/handleProductDeleted.ts
//
// Triggered by: products/delete webhook (GH-1262 A2.2)
//
// Shopify deletion is a COMMERCIAL lifecycle event. Every LaSyncro product
// parent historically mapped to the Shopify product is soft-deleted
// (products.status = 'deleted'). Nothing is hard-deleted or reparented:
// variant ids, LSP barcodes, identity mappings, stock history, orders, PO
// references and Receive lineage all stay resolvable. variants.status is
// deliberately untouched — physical stock on hand remains traceable.
//
// The deletion is also persisted as an is_deleted tombstone on the product's
// source watermark row, which syncProducts consults under the same lock, so it
// holds even when products/delete arrives before the product's first ingestion.
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';

/** Shopify products/delete payload is `{ id }`; accept the numeric id or its GID form. */
function parseShopifyProductId(id: unknown): string | null {
  const text = typeof id === 'string' ? id.trim()
    : typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : '';
  const match = /^(?:gid:\/\/shopify\/Product\/)?([1-9][0-9]*)$/.exec(text);
  return match ? match[1] : null;
}

// ISS-RLS2: trx REQUIRED — the router's transaction already carries
// SET LOCAL app.current_tenant for the shop resolved from the shop domain.
//
// Failure policy: an event that cannot be attributed (malformed id, missing
// or foreign shop) THROWS, so the ledger records it as failed and Shopify
// may retry — it is never acknowledged as a processed deletion.
export async function handleProductDeleted(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const raw = envelope.rawPayload as any;
  const numericId = parseShopifyProductId(raw?.id);
  console.info('[PRODUCT_DELETED_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    productId: raw?.id,
  });

  if (!numericId) {
    throw new Error('PRODUCT_DELETE_INVALID_PRODUCT_ID');
  }
  if (!envelope.shopDomain || typeof envelope.shopId !== 'number') {
    throw new Error('PRODUCT_DELETE_SHOP_UNRESOLVED');
  }

  // Shop ownership: the tenant-scoped installation for this domain must be
  // the shop the router resolved and set as tenant context.
  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: envelope.shopDomain })
    .select('shop_id')
    .first();
  if (!installation || Number(installation.shop_id) !== envelope.shopId) {
    throw new Error('PRODUCT_DELETE_SHOP_OWNERSHIP_MISMATCH');
  }
  const shopId = envelope.shopId;
  const externalProductId = `gid://shopify/Product/${numericId}`;

  // Same per-product lock key as syncProducts (shopifyProducts.core.ts):
  // serializes this deletion against a concurrent sync of the same product.
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
    'shopify_catalog_product', `${shopId}:${externalProductId}`,
  ]);

  // Persistent deletion tombstone, keyed by the external identity, so the
  // deletion holds even when the product was never ingested (a delayed
  // products/create must not resurrect it). The delete payload carries no
  // source timestamp: an existing source_updated_at is preserved, none is
  // fabricated. Re-applying is idempotent.
  await trx('shopify_product_source_watermarks')
    .insert({
      shop_id: shopId,
      platform: 'shopify',
      external_product_id: externalProductId,
      source_updated_at: null,
      is_deleted: true,
    })
    .onConflict(['shop_id', 'platform', 'external_product_id'])
    .merge({ is_deleted: true, updated_at: new Date().toISOString() });

  // Canonical identity path: external_product_identity_map → variants → products.
  // All historically split parents are included.
  const parentIds: string[] = await trx('external_product_identity_map as m')
    .join('variants as v', 'v.lasyncro_variant_id', 'm.lasyncro_variant_id')
    .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
    .where({
      'm.shop_id': shopId,
      'm.platform': 'shopify',
      'm.external_product_id': externalProductId,
      'p.shop_id': shopId,
    })
    .distinct('p.lasyncro_product_id')
    .pluck('p.lasyncro_product_id');

  if (parentIds.length === 0) {
    // Never ingested: the tombstone above is the only record; no identity is created.
    console.info('[PRODUCT_DELETED_UNKNOWN_PRODUCT]', { shopId, externalProductId });
    return;
  }

  await trx('products')
    .where({ shop_id: shopId })
    .whereIn('lasyncro_product_id', parentIds)
    .update({ status: 'deleted', updated_at: new Date().toISOString() });

  console.info('[PRODUCT_DELETED_TOMBSTONED]', {
    shopId,
    externalProductId,
    parentCount: parentIds.length,
  });
}
