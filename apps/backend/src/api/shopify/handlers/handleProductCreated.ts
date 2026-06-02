// apps/backend/src/api/shopify/handlers/handleProductCreated.ts
//
// Triggered by: products/create webhook
//
// Normalizes REST payload to GraphQL edges format and upserts into
// the LaSyncro catalog via syncProducts. New products become
// immediately searchable in PO variant search without manual resync.

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { syncProducts } from '../../../services/shopify/shopifyProducts.core.js';
import { normalizeRestProductToEdge } from './normalizeShopifyRestProduct.js';

export async function handleProductCreated(envelope: WebhookEnvelope): Promise<void> {
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

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: envelope.shopDomain })
    .select('shop_id')
    .first();

  if (!installation) {
    console.error('[PRODUCT_CREATED_INSTALLATION_NOT_FOUND]', { shopDomain: envelope.shopDomain });
    return;
  }

  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${installation.shop_id}'`);
    await syncProducts(trx, installation.shop_id, [normalizeRestProductToEdge(raw)]);
  });

  console.info('[PRODUCT_CREATED_SYNC_COMPLETE]', {
    shopDomain: envelope.shopDomain,
    productId: raw.id,
    variantCount: raw.variants?.length ?? 0,
  });
}