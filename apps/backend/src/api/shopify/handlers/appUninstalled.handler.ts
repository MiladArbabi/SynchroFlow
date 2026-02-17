// apps/backend/src/api/shopify/handlers/appUninstalled.handler.ts
//
// Handler: app/uninstalled
//
// RESPONSIBILITIES:
// - Execute domain mutation for Shopify app uninstall
//
// CONTRACT:
// - Called only AFTER ledger write + idempotency check
// - Throws on failure
// - Does NOT perform transport concerns

import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { handleAppUninstalled } from './handleAppUninstalled.js';

export async function onShopifyAppUninstalled(
  envelope: WebhookEnvelope
): Promise<void> {
  if (!envelope.shopDomain) {
    throw new Error('Missing shopDomain');
  }

  await handleAppUninstalled({
    shopDomain: envelope.shopDomain,
  });
}