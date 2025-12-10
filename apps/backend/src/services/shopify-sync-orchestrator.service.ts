// apps/backend/src/services/shopify-sync-orchestrator.service.ts
import { performInitialSync } from './shopify.service';
import { performNonPCDSync } from './shopify-fallback.service';
import { appendEvent } from '../../../../modules/specter/src/store/session-store';

export const performSmartSync = async (accessToken: string, platformShopName: string, shopId: number, integrationId: number) => {
  try {
    console.log(`[ShopifySyncOrchestrator] Attempting full sync for shopId: ${shopId}`);
    await performInitialSync(accessToken, platformShopName, shopId, integrationId);

    // Best-effort: record successful sync completion
    try {
      await appendEvent(shopId, {
        type: 'sync.complete',
        integrationId,
        timestamp: Date.now()
      });
    } catch (e: any) {
      // Do not block on Specter failures
      // eslint-disable-next-line no-console
      console.warn('[ShopifySyncOrchestrator] specter appendEvent(sync.complete) failed:', e && e.message ? e.message : e);
    }
  } catch (error: any) {
    // PCD-specific fallback
    if (error && (String(error.message).includes('not approved to access the Order object') ||
        String(error.message).includes('Protected Customer Data'))) {
      console.log(`[ShopifySyncOrchestrator] PCD access denied, falling back to non-PCD sync for shopId: ${shopId}`);
      await performNonPCDSync(accessToken, platformShopName, shopId, integrationId);

      // Best-effort: record successful fallback sync completion (mark as fallback)
      try {
        await appendEvent(shopId, {
          type: 'sync.complete',
          integrationId,
          fallback: true,
          timestamp: Date.now()
        });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn('[ShopifySyncOrchestrator] specter appendEvent(sync.complete fallback) failed:', e && e.message ? e.message : e);
      }

      return;
    }

    // Non-PCD error: record error event and rethrow
    try {
      await appendEvent(shopId, {
        type: 'sync.error',
        error: {
          message: error?.message ?? String(error),
          stack: error?.stack
        },
        timestamp: Date.now()
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('[ShopifySyncOrchestrator] specter appendEvent(sync.error) failed:', e && e.message ? e.message : e);
    }

    throw error;
  }
};