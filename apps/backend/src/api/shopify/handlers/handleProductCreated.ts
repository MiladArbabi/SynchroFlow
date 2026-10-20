// apps/backend/src/api/shopify/handlers/handleProductCreated.ts
//
// Triggered by: products/create webhook
//
// Normalizes REST payload to GraphQL edges format and upserts into
// the LaSyncro catalog via syncProducts. New products become
// immediately searchable in PO variant search without manual resync.
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
// Failure policy (GH-1262 A2.3): an invalid creation payload (missing title,
// malformed identity, unknown status) or an unattributable shop THROWS, so the
// ledger records the event as failed — it is never acknowledged as processed.
export async function handleProductCreated(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const raw = envelope.rawPayload as any;
  console.info('[PRODUCT_CREATED_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    productId: raw?.id,
  });
  if (typeof raw?.title !== 'string' || raw.title.trim() === '') {
    throw new Error('PRODUCT_CREATE_TITLE_REQUIRED');
  }
  const edge = normalizeRestProductToEdge(raw);
  if (!envelope.shopDomain) {
    throw new Error('PRODUCT_CREATE_SHOP_UNRESOLVED');
  }
  // Shop ownership: the tenant-scoped installation for this domain must exist
  // and, when the router resolved one, be the shop set as tenant context.
  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: envelope.shopDomain })
    .select('shop_id')
    .first();
  if (!installation) {
    throw new Error('PRODUCT_CREATE_INSTALLATION_NOT_FOUND');
  }
  if (envelope.shopId !== undefined && Number(installation.shop_id) !== envelope.shopId) {
    throw new Error('PRODUCT_CREATE_SHOP_OWNERSHIP_MISMATCH');
  }
  await syncProducts(trx, installation.shop_id, [edge]);
  console.info('[PRODUCT_CREATED_SYNC_COMPLETE]', {
    shopDomain: envelope.shopDomain,
    productId: raw.id,
    variantCount: raw.variants?.length ?? 0,
  });
}
