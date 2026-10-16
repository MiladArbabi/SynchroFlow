import { withTenant } from '@lasyncro/backend-core/db.js';
import { lockShopifyAdminCredentialRotation } from './shopifyAdminCredential.repository.js';

export interface ShopifySyncExecutionAuthority {
  installationId: number;
  shopDomain: string;
  generation: string;
}

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
  executionAuthority,
}: {
  integrationId: number;
  shopId: number;
  status: string;
  progressCurrent?: number;
  progressTotal?: number;
  error?: string | null;
  // Temporarily optional for migration of existing callers.
  // Runtime enforcement below is unconditional.
  executionAuthority?: ShopifySyncExecutionAuthority;
}) => {
  if (
    !executionAuthority ||
    !Number.isSafeInteger(executionAuthority.installationId) ||
    executionAuthority.installationId <= 0 ||
    typeof executionAuthority.shopDomain !== 'string' ||
    !executionAuthority.shopDomain ||
    typeof executionAuthority.generation !== 'string' ||
    !/^\d+$/.test(executionAuthority.generation)
  ) {
    throw new Error('SHOPIFY_SYNC_AUTHORITY_REQUIRED');
  }

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
      // Same transaction-level lock used by uninstall, refresh and reconnect.
      // No generation can advance between this check and the status/event commit.
      await lockShopifyAdminCredentialRotation(trx, shopId);

      const authority = await trx('shopify_app_installations as installation')
        .join('shopify_admin_credentials as credential', function () {
          this.on('credential.installation_id', '=', 'installation.id')
            .andOn('credential.shop_id', '=', 'installation.shop_id');
        })
        .where({
          'installation.id': executionAuthority.installationId,
          'installation.shop_id': shopId,
          'installation.shop_domain': executionAuthority.shopDomain,
          'credential.credential_state': 'ACTIVE',
          'credential.credential_generation': executionAuthority.generation,
        })
        .whereNull('installation.uninstalled_at')
        .first('installation.id');

      if (!authority) {
        throw new Error('SHOPIFY_SYNC_STALE_AUTHORITY');
      }

      const updated = await trx('integrations')
        .where({
          id: integrationId,
          shop_id: shopId,
          platform: 'shopify',
          platform_shop_name: executionAuthority.shopDomain,
        })
        .update(updatePayload);

      if (updated !== 1) {
        throw new Error('SHOPIFY_SYNC_INTEGRATION_NOT_FOUND');
      }

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
