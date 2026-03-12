// apps/backend/src/projection/projection.registry.ts
import { Knex } from 'knex';

import { handleOrdersCreate } from './handlers/orders.create.js';
import { handleOrdersPaid } from './handlers/orders.paid.js';
import { handleOrdersFulfilled } from './handlers/orders.fulfilled.js';
import { handleRefundsCreate } from './handlers/refunds.create.js';
import { handleLifecycleFT0Completed } from './handlers/lifecycle.ft0_completed.js';
import { handleLifecycleFT2Confirmed } from './handlers/lifecycle.ft2_confirmed.js';
import { handleLifecycleFirstInsightDelivered } from './handlers/lifecycle.first_insight_delivered.js';
import { handleIntegrationSyncRequested } from './handlers/integration.sync_requested.js';

/**
 * PROJECTION HANDLER CONTRACT
 * ---------------------------
 * All handlers execute inside the projection engine transaction.
 * trx is injected by projection.engine to guarantee:
 *
 * - atomic projection updates
 * - deterministic replay
 * - consistent cursor advancement
 */
export type ProjectionHandler = (params: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) => Promise<void>;

/**
 * EVENT NORMALIZATION
 * -------------------
 * Shopify historical ingestion produces `orders/sync`
 * while live webhooks produce `orders/create`.
 *
 * Both represent the same semantic event and must
 * be projected through the same handler to preserve
 * deterministic rebuild guarantees.
 */
export const projectionRegistry: Record<string, ProjectionHandler> = {
  'orders/create': handleOrdersCreate,
  'orders/sync': handleOrdersCreate,
  'integration/sync_requested': handleIntegrationSyncRequested,
  'orders/paid': handleOrdersPaid,
  'orders/fulfilled': handleOrdersFulfilled,
  'refunds/create': handleRefundsCreate,
  /**
   * INVENTORY LEVEL UPDATES
   * -----------------------
   * Shopify inventory webhooks enter the domain event log
   * but inventory truth is currently derived from
   * reconciliation + inventory projection rebuild.
   *
   * This handler intentionally performs no mutation.
   *
   * Purpose:
   * - prevent silent projection drop
   * - provide operational visibility
   * - preserve deterministic replay behavior
   */
  'inventory_levels/update': async ({ domainEvent }) => {
    console.info('[PROJECTION_INVENTORY_EVENT_OBSERVED]', {
      shopId: domainEvent.shop_id,
      eventId: domainEvent.id,
    });
  },
  'lifecycle/ft0_completed': handleLifecycleFT0Completed,
  'lifecycle/ft2_confirmed': handleLifecycleFT2Confirmed,
  'lifecycle/first_insight_delivered': handleLifecycleFirstInsightDelivered,
};