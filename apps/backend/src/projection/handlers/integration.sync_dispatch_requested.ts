// apps/backend/src/projection/handlers/integration.sync_dispatch_requested.ts
import { Knex } from 'knex';

/**
 * PROJECTION — integration/sync_dispatch_requested (GH-1068 T3-B)
 * ---------------------------------------------------------------
 * Durable Shopify sync dispatch intent. Delivery belongs exclusively to the
 * domain-event outbox dispatcher (claim → confirmed publish → marked).
 *
 * This handler is intentionally inert: projection, rebuild and replay must
 * never publish, schedule or launch Shopify sync, and never touch the
 * projection transaction. It exists only so the event type is covered.
 */
export async function handleIntegrationSyncDispatchRequested(_params: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}): Promise<void> {
  return;
}
