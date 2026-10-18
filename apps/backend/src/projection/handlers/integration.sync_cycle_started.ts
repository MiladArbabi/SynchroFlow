// apps/backend/src/projection/handlers/integration.sync_cycle_started.ts
import { Knex } from 'knex';

/**
 * PROJECTION — integration/sync_cycle_started (GH-1068 T3-B)
 * ----------------------------------------------------------
 * One-time fact that a durable sync intent started its single cycle. It is
 * written atomically with the fenced worker claim, never by projection.
 *
 * This handler is intentionally inert: projection, rebuild and replay must
 * never publish jobs, start timers, mutate operational state or touch the
 * projection transaction. It exists only so the event type is covered.
 */
export async function handleIntegrationSyncCycleStarted(_params: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}): Promise<void> {
  return;
}
