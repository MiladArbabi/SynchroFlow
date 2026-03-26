// apps/backend/src/projection/handlers/integration.sync_requested.ts
import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';

/**
 * PROJECTION — integration/sync_requested
 * ---------------------------------------
 * PURPOSE
 * -------
 * Emit an operational signal confirming that the
 * Shopify sync lifecycle has been initiated.
 *
 * This handler intentionally performs no mutation.
 *
 * Reason:
 * - The actual sync job is executed via the sync worker.
 * - The domain event ensures deterministic lifecycle visibility.
 *
 * This projection exists to guarantee:
 * - event replay safety
 * - observability of sync lifecycle events
 * - prevention of unhandled event types
 */

export async function handleIntegrationSyncRequested({
  domainEvent,
  trx
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {
  console.info('[projection][integration_sync_requested]', {
    shopId: domainEvent.shop_id,
    integrationId: domainEvent.event_payload?.integration_id,
  });

  /**
   * ⚠️ INGESTION WATCHDOG SIGNAL
   * --------------------------------
   * Detects cases where sync starts but no ingestion follows.
   *
   * This prevents silent FT_MINUS_ONE stalls.
   */
  console.warn('[INGESTION_EXPECTED_AFTER_SYNC]', {
    shopId: domainEvent.shop_id,
  });

  const traceId = domainEvent.event_payload?.trace_id;

  console.info('[projection][integration_sync_requested]', {
    shopId: domainEvent.shop_id,
    integrationId: domainEvent.event_payload?.integration_id,
    traceId,
  });

  /**
   * INGESTION WATCHDOG (v2 — STALL DETECTION)
   * -----------------------------------------
   * Detects:
   * 1. No ingestion at all
   * 2. Ingestion started but stalled
   *
   * Strategy:
   * - Sample order count twice
   * - If no growth → ingestion stalled
   */
  setTimeout(async () => {
    try {
      const firstSample = await db('orders')
        .where({ shop_id: domainEvent.shop_id })
        .count<{ count: string }>('* as count')
        .first();

      const count1 = Number(firstSample?.count ?? 0);

      // wait 15s more to detect movement
      await new Promise(res => setTimeout(res, 15000));

      const secondSample = await db('orders')
        .where({ shop_id: domainEvent.shop_id })
        .count<{ count: string }>('* as count')
        .first();

      const count2 = Number(secondSample?.count ?? 0);

      if (count1 === 0 && count2 === 0) {
        console.error('[INGESTION_MISSING_AFTER_SYNC]', {
          shopId: domainEvent.shop_id,
          action: 'SYNC_NOT_PRODUCING_EVENTS',
        });
        return;
      }

      if (count2 === count1) {
        console.error('[INGESTION_STALLED]', {
          shopId: domainEvent.shop_id,
          count: count2,
          action: 'PIPELINE_HALTED_AFTER_START',
        });
        return;
      }

      console.info('[INGESTION_HEALTHY]', {
        shopId: domainEvent.shop_id,
        startCount: count1,
        endCount: count2,
      });

    } catch (err) {
      console.error('[INGESTION_WATCHDOG_FAILED]', {
        shopId: domainEvent.shop_id,
        error: err,
      });
    }
  }, 30000);
}