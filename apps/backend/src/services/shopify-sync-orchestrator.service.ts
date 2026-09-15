// apps/backend/src/services/shopify-sync-orchestrator.service.ts

import { performNonPCDSync } from "./shopify-fallback.service.js";
import { performInitialSync } from "./shopify.service.js";

/**
 * Orchestrates a "smart" sync for Shopify integrations.
 * - Tries the full (PCD) sync first via performInitialSync.
 * - If PCD access is denied, falls back to performNonPCDSync.
 * 
 */
export const performSmartSync = async (
  accessToken: string,
  platformShopName: string,
  shopId: number,
  integrationId: number
): Promise<void> => {

  console.info('[SHOPIFY_SMART_SYNC_STARTED]', {
    shopId,
    integrationId,
  });
  
  try {
    console.log(`[ShopifySyncOrchestrator] Attempting full sync for shopId: ${shopId}`);
    await performInitialSync(accessToken, platformShopName, shopId, integrationId);

    return;
  } catch (error: any) {
    // PCD-specific fallback: attempt non-PCD sync.
    if (
      error &&
      (String(error.message).includes('not approved to access the Order object') ||
        String(error.message).includes('Protected Customer Data'))
    ) {
      console.log(`[ShopifySyncOrchestrator] PCD access denied, falling back to non-PCD sync for shopId: ${shopId}`);
      await performNonPCDSync(accessToken, platformShopName, shopId, integrationId);

      return;
    }

    throw error;
  }
};
