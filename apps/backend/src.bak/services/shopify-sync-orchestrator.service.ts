// apps/backend/src/services/shopify-sync-orchestrator.service.ts
import { performInitialSync } from './shopify.service';
import { performNonPCDSync } from './shopify-fallback.service';

export const performSmartSync = async (accessToken: string, platformShopName: string, shopId: number, integrationId: number) => {
  try {
    console.log(`[ShopifySyncOrchestrator] Attempting full sync for shopId: ${shopId}`);
    await performInitialSync(accessToken, platformShopName, shopId, integrationId);
  } catch (error: any) {
    if (error.message.includes('not approved to access the Order object') || 
        error.message.includes('Protected Customer Data')) {
      console.log(`[ShopifySyncOrchestrator] PCD access denied, falling back to non-PCD sync for shopId: ${shopId}`);
      await performNonPCDSync(accessToken, platformShopName, shopId, integrationId);
    } else {
      throw error;
    }
  }
};