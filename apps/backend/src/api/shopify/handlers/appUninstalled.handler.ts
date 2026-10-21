// apps/backend/src/api/shopify/handlers/appUninstalled.handler.ts
//
// Handler: app/uninstalled
//
// RESPONSIBILITIES:
// - Persist the durable verification intent for an authenticated receipt
//
// CONTRACT:
// - Called only AFTER ledger write + idempotency check
// - Throws on failure
// - Does NOT perform transport concerns
//
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { recordShopifyUninstallVerification } from '../../../services/shopify/shopifyUninstallVerification.repository.js';

export async function onShopifyAppUninstalled(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction,
): Promise<void> {
  // SHB-16: envelope.shopId is now populated by WebhookRouter after
  // shopDomain resolution — trusted here rather than re-deriving.
  if (!envelope.shopId) {
    throw new Error('[shopify][app_uninstalled] shopId required');
  }
  if (!envelope.verified || !envelope.shopDomain) {
    throw new Error('SHOPIFY_UNINSTALL_VERIFIED_IDENTITY_REQUIRED');
  }
  await recordShopifyUninstallVerification(trx, {
    shopId: envelope.shopId,
    eventId: envelope.eventId,
    shopDomain: envelope.shopDomain,
  });
}
