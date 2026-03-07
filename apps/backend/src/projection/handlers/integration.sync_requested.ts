// apps/backend/src/projection/handlers/integration.sync_requested.ts

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
}