// apps/backend/src/services/shopify-sync-orchestrator.service.ts
import { performInitialSync } from './shopify.service';
import { performNonPCDSync } from './shopify-fallback.service';
import { appendEvent, recordShopSession } from 'modules-specter/store/session-store';

/**
 * Orchestrates a "smart" sync for Shopify integrations.
 * - Tries the full (PCD) sync first via performInitialSync.
 * - If PCD access is denied, falls back to performNonPCDSync.
 * 
 * All Specter interactions are best-effort and non-fatal: failures
 * to write events or sessions should never block or fail the sync flow.
 */
export const performSmartSync = async (
  accessToken: string,
  platformShopName: string,
  shopId: number,
  integrationId: number
): Promise<void> => {
  try {
    console.log(`[ShopifySyncOrchestrator] Attempting full sync for shopId: ${shopId}`);
    await performInitialSync(accessToken, platformShopName, shopId, integrationId);

    // Best-effort: record successful sync completion (event)
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

    // Best-effort: update lightweight session metadata (non-blocking)
    (async () => {
      try {
        await recordShopSession(shopId, {
          // minimal session footprint
          createdAt: new Date().toISOString(),
          exitIntent: false,
          lastSync: Date.now(),
          lastSyncStatus: 'success',
          integrationId
        } as any);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn('[ShopifySyncOrchestrator] specter recordShopSession(lastSync success) failed:', e && e.message ? e.message : e);
      }
    })();

    return;
  } catch (error: any) {
    // PCD-specific fallback: attempt non-PCD sync then record success
    if (
      error &&
      (String(error.message).includes('not approved to access the Order object') ||
        String(error.message).includes('Protected Customer Data'))
    ) {
      console.log(`[ShopifySyncOrchestrator] PCD access denied, falling back to non-PCD sync for shopId: ${shopId}`);
      await performNonPCDSync(accessToken, platformShopName, shopId, integrationId);

      // Best-effort: record fallback sync completion (event)
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

      // Best-effort: update lightweight session metadata (non-blocking)
      (async () => {
        try {
          await recordShopSession(shopId, {
            createdAt: new Date().toISOString(),
            exitIntent: false,
            lastSync: Date.now(),
            lastSyncStatus: 'success',
            integrationId,
            fallback: true
          } as any);
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('[ShopifySyncOrchestrator] specter recordShopSession(lastSync fallback) failed:', e && e.message ? e.message : e);
        }
      })();

      return;
    }

    // Non-PCD error: record error event (best-effort) and update session metadata, then rethrow
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

    // Best-effort: record session metadata about the failure (non-blocking)
    (async () => {
      try {
        await recordShopSession(shopId, {
          createdAt: new Date().toISOString(),
          exitIntent: false,
          lastSync: Date.now(),
          lastSyncStatus: 'error',
          lastSyncError: error?.message ?? String(error),
          integrationId
        } as any);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn('[ShopifySyncOrchestrator] specter recordShopSession(lastSync error) failed:', e && e.message ? e.message : e);
      }
    })();

    throw error;
  }
};