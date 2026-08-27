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

    await withTenant(shopId, async (trx) => {
      await trx('integrations')
        .where({ id: integrationId, shop_id: shopId })
        .update(updatePayload);

      /**
       * ATOMIC COMPLETION EVENT EMISSION (SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02)
       * -----------------------------------------------------------------------
       * Only the main/authoritative sync path reaches this function with
       * status:'COMPLETED', error:null. The PCD-restricted fallback path
       * (shopify-fallback.service.ts) writes sync_status directly and
       * bypasses this helper entirely — it structurally can never emit
       * this event, so a partial/PCD-limited completion is never mistaken
       * for a legitimate authoritative sync.
       *
       * Same transaction as the status write: there is no committed state
       * where sync_status='COMPLETED' persists without the corresponding
       * domain event, because both are one transaction — the outbox row
       * is created automatically by the existing
       * auto_create_domain_event_outbox trigger.
       *
       * Recurring event, not a once-per-shop milestone — a shop may
       * legitimately complete sync many times over its life (reinstall,
       * resync). No shop-wide uniqueness constraint is introduced.
       * Duplicate emissions (e.g. queue message redelivery re-running a
       * sync job) are tolerated by the consuming projection handler's own
       * "snapshot absent" state guard, not by a producer-side dedup key.
       */
      if (status === 'COMPLETED' && (error ?? null) === null) {
        await trx('domain_events').insert({
          shop_id: shopId,
          event_type: 'integration/sync_completed',
          event_payload: { integration_id: integrationId },
          event_time: trx.fn.now(),
          event_version: 1,
          external_event_id: `internal:integration/sync_completed:${integrationId}:${Date.now()}`,
        });
      }
    });

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
