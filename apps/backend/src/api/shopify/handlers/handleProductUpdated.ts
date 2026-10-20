// apps/backend/src/api/shopify/handlers/handleProductUpdated.ts
//
// Triggered by: products/update webhook
//
// Merges changed variant fields (title, SKU, barcode, image) into the
// LaSyncro catalog. syncProducts onConflict(lasyncro_variant_id) preserves
// existing variant IDs and product references — no orphan data.
import type { Knex } from 'knex';
import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { syncProducts } from '../../../services/shopify/shopifyProducts.core.js';
import { normalizeRestProductToEdge } from './normalizeShopifyRestProduct.js';

// ISS-RLS2: trx REQUIRED — see handleOrderCreated.ts header comment.
// Previously opened its own inner db.transaction() with SET LOCAL —
// redundant now that the router's trx already has tenant context set
// for this same shop. Uses the router's trx directly instead.
//
// Failure policy (GH-1262 A2.3): malformed identity, an unknown status or an
// unattributable shop THROWS, so the ledger records the event as failed. A
// valid partial update may omit title — the persisted title is preserved.
export async function handleProductUpdated(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const raw = envelope.rawPayload as any;
  console.info('[PRODUCT_UPDATED_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    productId: raw?.id,
  });
  const edge = normalizeRestProductToEdge(raw);
  if (!envelope.shopDomain) {
    throw new Error('PRODUCT_UPDATE_SHOP_UNRESOLVED');
  }
  // Shop ownership: the tenant-scoped installation for this domain must exist
  // and, when the router resolved one, be the shop set as tenant context.
  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: envelope.shopDomain })
    .select('shop_id')
    .first();
  if (!installation) {
    throw new Error('PRODUCT_UPDATE_INSTALLATION_NOT_FOUND');
  }
  if (envelope.shopId !== undefined && Number(installation.shop_id) !== envelope.shopId) {
    throw new Error('PRODUCT_UPDATE_SHOP_OWNERSHIP_MISMATCH');
  }
  await syncProducts(trx, installation.shop_id, [edge]);
  console.info('[PRODUCT_UPDATED_SYNC_COMPLETE]', {
    shopDomain: envelope.shopDomain,
    productId: raw.id,
    variantCount: raw.variants?.length ?? 0,
  });
}
