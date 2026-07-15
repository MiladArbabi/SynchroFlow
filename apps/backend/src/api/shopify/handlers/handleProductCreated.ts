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
  if (!raw?.id || !raw?.title || !envelope.shopDomain) {
    console.error('[PRODUCT_CREATED_GUARD_FAILED]', {
      hasId: !!raw?.id,
      hasTitle: !!raw?.title,
      shopDomain: envelope.shopDomain,
    });
    return;
  }
  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: envelope.shopDomain })
    .select('shop_id')
    .first();
  if (!installation) {
    console.error('[PRODUCT_CREATED_INSTALLATION_NOT_FOUND]', { shopDomain: envelope.shopDomain });
    return;
  }
  await syncProducts(trx, installation.shop_id, [normalizeRestProductToEdge(raw)]);
  console.info('[PRODUCT_CREATED_SYNC_COMPLETE]', {
    shopDomain: envelope.shopDomain,
    productId: raw.id,
    variantCount: raw.variants?.length ?? 0,
  });
}
