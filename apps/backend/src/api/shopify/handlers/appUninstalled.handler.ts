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

import { ShopifyAppService } from 'api-src/services/shopify-app.service';

export async function handleAppUninstalled(params: {
  shopDomain: string;
}): Promise<void> {
  const { shopDomain } = params;

  await ShopifyAppService.markAppUninstalled(shopDomain);
}