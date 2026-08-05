import { withTenant } from '@lasyncro/backend-core/db.js';

/**
 * SHOPIFY INTEGRATION STATUS SERVICE
 * ----------------------------------
 * Centralizes sync status updates.
 *
 * Guarantees:
 * - no duplicated status logic
 * - consistent lifecycle transitions
 * - easier debugging of sync phases
 */

export const updateIntegrationStatus = async ({
  integrationId,
  shopId,
  status,
  progressCurrent,
  progressTotal,
  error,
}: {
  integrationId: number;
  shopId: number;
  status: string;
  progressCurrent?: number;
  progressTotal?: number;
  error?: string | null;
}) => {
  /**
     * PROGRESS PERSISTENCE GUARANTEE
     * ------------------------------
     * Never overwrite progress_total with undefined.
     * Preserves total across phases.
     */
    const updatePayload: any = {
    sync_status: status,
    sync_last_error: error ?? null,
    };

    if (progressCurrent !== undefined) {
    updatePayload.sync_progress_current = progressCurrent;
    }

    if (progressTotal !== undefined) {
    updatePayload.sync_progress_total = progressTotal;
    }

    await withTenant(shopId, (trx) =>
      trx('integrations')
        .where({ id: integrationId, shop_id: shopId })
        .update(updatePayload)
    );

  /**
     * LOG ACTUAL WRITTEN STATE
     * ------------------------
     * Avoid logging undefined values that were not persisted.
     */
    console.info('[SHOPIFY_INTEGRATION_STATUS_UPDATED]', {
    integrationId,
    shopId,
    status,
    ...(progressCurrent !== undefined && { progressCurrent }),
    ...(progressTotal !== undefined && { progressTotal }),
    });
};
