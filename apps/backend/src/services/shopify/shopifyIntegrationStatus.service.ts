import crypto from 'crypto';
import type { Knex } from 'knex';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { lockShopifyAdminCredentialRotation } from './shopifyAdminCredential.repository.js';

export interface ShopifySyncExecutionAuthority {
  installationId: number;
  shopDomain: string;
  generation: string;
}

/**
 * GH-1068 T3-B durable sync intent. The domain event id is the immutable
 * intent identity carried by every sync_jobs message.
 */
export const SHOPIFY_SYNC_DISPATCH_EVENT = 'integration/sync_dispatch_requested';

export type ShopifySyncCycleClaim =
  | { kind: 'CLAIMED' }
  | {
      kind: 'REJECTED';
      reason: 'INTENT_NOT_FOUND' | 'INTENT_NOT_CURRENT' | 'INTENT_CONSUMED' | 'NOT_ELIGIBLE';
    };

/**
 * One-time start fact, appended in the claim transaction. Distinct from the
 * durable dispatch request (integration/sync_dispatch_requested) and from the
 * callback's observability event (integration/sync_requested).
 * domain_events_shop_external_event_unique makes a second start of the same
 * intent impossible.
 */
export const SHOPIFY_SYNC_CYCLE_STARTED_EVENT = 'integration/sync_cycle_started';

const syncCycleStartedExternalId = (intentDomainEventId: number) =>
  `internal:integration/sync_cycle_started:${intentDomainEventId}`;

const isPositiveId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

function requireExecutionAuthority(
  executionAuthority: ShopifySyncExecutionAuthority | undefined,
): asserts executionAuthority is ShopifySyncExecutionAuthority {
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
}

/** Caller holds the canonical T2 lock: the generation cannot advance before commit. */
async function assertActiveExecutionAuthority(
  trx: Knex.Transaction,
  shopId: number,
  executionAuthority: ShopifySyncExecutionAuthority,
): Promise<void> {
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
}

/**
 * Record a first-install / legacy-bootstrap sync intent inside the caller's
 * tenant transaction, atomically with the integration it names. Reconnect
 * intents are written exclusively by the 0216 finalizer.
 */
export async function recordShopifySyncDispatchIntent(
  trx: Knex.Transaction,
  { shopId, integrationId, installationId }: { shopId: number; integrationId: number; installationId: number },
): Promise<void> {
  await trx('domain_events').insert({
    shop_id: shopId,
    event_type: SHOPIFY_SYNC_DISPATCH_EVENT,
    event_payload: { integration_id: integrationId, installation_id: installationId, source: 'install' },
    event_time: trx.fn.now(),
    event_version: 1,
    external_event_id: `internal:${SHOPIFY_SYNC_DISPATCH_EVENT}:${integrationId}:install:${crypto.randomUUID()}`,
  });
}

/**
 * SINGLE-FLIGHT, ONE-TIME CYCLE START (GH-1068 T3-B)
 * --------------------------------------------------
 * Under the canonical T2 lock and the current authenticated generation, the
 * supplied intent must exist in this tenant, name this integration and
 * installation, be the latest intent for the integration, and not have
 * started a cycle before. Only then is PENDING - or FAILED, for a
 * first-install / legacy-bootstrap intent - atomically claimed as
 * SYNCING_PRODUCTS (legal T3-A transitions only; COMPLETED is never claimed),
 * together with the intent's one-time start record. Every rejection writes
 * nothing; a stale generation throws SHOPIFY_SYNC_STALE_AUTHORITY.
 *
 * A token refresh is not a new cycle: the intent stays current across it and
 * starts under whichever generation is active when the worker claims.
 */
export const claimShopifySyncCycle = async ({
  integrationId,
  shopId,
  intentDomainEventId,
  executionAuthority,
}: {
  integrationId: number;
  shopId: number;
  intentDomainEventId: number;
  executionAuthority: ShopifySyncExecutionAuthority;
}): Promise<ShopifySyncCycleClaim> => {
  requireExecutionAuthority(executionAuthority);
  if (!isPositiveId(integrationId) || !isPositiveId(shopId) || !isPositiveId(intentDomainEventId)) {
    throw new Error('SHOPIFY_SYNC_INTENT_REQUIRED');
  }

  return withTenant(shopId, async (trx) => {
    await lockShopifyAdminCredentialRotation(trx, shopId);
    await assertActiveExecutionAuthority(trx, shopId, executionAuthority);

    const intent = await trx('domain_events')
      .where({ id: intentDomainEventId, shop_id: shopId, event_type: SHOPIFY_SYNC_DISPATCH_EVENT })
      .first('id', 'event_payload');
    if (
      !intent ||
      Number(intent.event_payload?.integration_id) !== integrationId ||
      Number(intent.event_payload?.installation_id) !== executionAuthority.installationId
    ) {
      return { kind: 'REJECTED', reason: 'INTENT_NOT_FOUND' } as const;
    }

    const newer = await trx('domain_events')
      .where({ shop_id: shopId, event_type: SHOPIFY_SYNC_DISPATCH_EVENT })
      .whereRaw("event_payload->>'integration_id' = ?", [String(integrationId)])
      .where('id', '>', intentDomainEventId)
      .first('id');
    if (newer) {
      return { kind: 'REJECTED', reason: 'INTENT_NOT_CURRENT' } as const;
    }

    const started = await trx('domain_events')
      .where({ shop_id: shopId, external_event_id: syncCycleStartedExternalId(intentDomainEventId) })
      .first('id');
    if (started) {
      return { kind: 'REJECTED', reason: 'INTENT_CONSUMED' } as const;
    }

    const eligibleStatuses = intent.event_payload?.source === 'install'
      ? ['PENDING', 'FAILED']
      : ['PENDING'];
    const claimed = await trx('integrations')
      .where({
        id: integrationId,
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: executionAuthority.shopDomain,
      })
      .whereIn('sync_status', eligibleStatuses)
      .update({
        sync_status: 'SYNCING_PRODUCTS',
        sync_progress_current: 0,
        sync_progress_total: 0,
        sync_last_error: null,
      });
    if (claimed !== 1) {
      return { kind: 'REJECTED', reason: 'NOT_ELIGIBLE' } as const;
    }

    // Same transaction as the claim: the intent can never start a second cycle.
    await trx('domain_events').insert({
      shop_id: shopId,
      event_type: SHOPIFY_SYNC_CYCLE_STARTED_EVENT,
      event_payload: {
        integration_id: integrationId,
        intent_domain_event_id: intentDomainEventId,
      },
      event_time: trx.fn.now(),
      event_version: 1,
      external_event_id: syncCycleStartedExternalId(intentDomainEventId),
    });
    return { kind: 'CLAIMED' } as const;
  });
};

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
  requireExecutionAuthority(executionAuthority);

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
      await assertActiveExecutionAuthority(trx, shopId, executionAuthority);

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
