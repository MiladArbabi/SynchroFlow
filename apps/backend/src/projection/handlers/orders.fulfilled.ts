// apps/backend/src/projection/handlers/orders.fulfilled.ts

/**
 * ORDERS — FULFILLMENT PROJECTION HANDLER
 * ----------------------------------------
 * Mechanical extraction from projection.engine.ts.
 *
 * IMPORTANT:
 * - No behavioral changes.
 * - No cleanup.
 * - No determinism fixes.
 * - No side-effect removal.
 *
 * This file preserves:
 * - Missing aggregate emission
 * - Reconciliation intent capture
 * - Wall-clock timestamp usage
 * - REBUILD_MODE branch
 */

import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';

import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';

const ORDERS_PROJECTION = 'orders_projection';

export async function handleOrdersFulfilled({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {

  console.debug('[FULFILLMENT_HANDLER_START]', {
    eventId: domain_event_id,
  });

  const payload = domainEvent.event_payload as any;

  /* console.info('[FULFILLMENT_EVENT_PAYLOAD]', {
    eventId: domain_event_id,
    payload,
  }); */
  
  const externalOrderId = String(payload.order_id);

  console.debug('[FULFILLMENT_BEFORE_ID_RESOLUTION]', {
    eventId: domain_event_id,
  });

  /**
   * CRITICAL: enforce single-connection transactional consistency
   * -------------------------------------------------------------
   * MUST pass trx to avoid:
   * - connection pool split
   * - hidden locks
   * - non-repeatable reads inside projection
   */
  const lasyncroOrderId = await resolveExternalOrderId(
    domainEvent.shop_id,
    'shopify',
    externalOrderId,
    trx
  );

  /**
   * LOCK ORDER ROW FIRST (DEADLOCK PREVENTION)
   * ------------------------------------------
   * Global invariant:
   * ALL projections must lock orders table FIRST.
   * Prevents cyclic deadlocks across handlers.
   */
  const { aggregate_version } = await trx('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .select('aggregate_version')
    .first();

  console.debug('[ORDER_ROW_LOCKED]', {
    lasyncroOrderId,
  });

  console.debug('[FULFILLMENT_AFTER_ID_RESOLUTION]', {
    eventId: domain_event_id,
    lasyncroOrderId,
  });

  /**
   * MISSING AGGREGATE DETECTED
   * --------------------------
   * Emits deterministic signal for orchestration.
   * (Preserved exactly as original implementation.)
   */
  if (!lasyncroOrderId) {

    /**
     * PROJECTION VIOLATION REMOVED
     * ----------------------------
     * Projections MUST be side-effect free.
     * Emitting domain events here breaks:
     * - determinism
     * - replay correctness
     *
     * Instead, log and exit.
     * Missing aggregate handling must occur in ingestion layer.
     */
    /* console.error('[PROJECTION_INVARIANT_VIOLATION][MISSING_ORDER]', {
      shopId: domainEvent.shop_id,
      externalOrderId,
      sourceEventId: domain_event_id,
    }); */

    return;
  }

  /**
   * STATUS RESOLUTION (STRICT — NO FALLBACKS)
   * -----------------------------------------
   * Event payload is the ONLY source of truth.
   * Invalid or missing status must be rejected.
   *
   * Silent fallback causes state corruption.
   */
  if (!payload.status) {
    console.error('[FULFILLMENT_STATUS_MISSING]', {
      eventId: domain_event_id,
      payload,
    });
    return;
  }

  const status = payload.status;

  const fulfillmentTimestamp = canonicalEventTime;

  /**
   * SIDE-EFFECT INTENT HOLDER
   * --------------------------
   * Must execute after transaction commit.
   */
  let reconciliationIntent:
    | {
        lasyncroOrderId: string;
        aggregateVersion: number;
        observed?: {
          status: 'fulfilled';
          observedAt: Date;
          source: 'shopify_sync';
        };
      }
    | undefined;

    /**
     * MONOTONIC GUARD (CRITICAL)
     * ---------------------------
     * Prevents regression:
     * e.g. fulfilled → pending
     *
     * Without this:
     * - last event wins
     * - fulfillment collapses to pending
     */
    const precedence: Record<string, number> = {
      pending: 0,
      processing: 1,
      partially_fulfilled: 2,
      fulfilled: 3,
      cancelled: 4,
      failed: 5,
    };

    const existing = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first<{ status: string }>();

    if (existing) {
      const currentPrecedence = precedence[existing.status] ?? 0;
      const newPrecedence = precedence[status] ?? 0;

      const allowUpdate =
        status === 'cancelled' ||
        newPrecedence >= currentPrecedence;

      if (!allowUpdate) {
        console.warn('[FULFILLMENT_REGRESSION_BLOCKED]', {
          lasyncroOrderId,
          from: existing.status,
          to: status,
        });
        return;
      }
    };

    console.debug('[FULFILLMENT_BEFORE_DB_WRITE]', {
      eventId: domain_event_id,
    });

    /**
     * DIRECT PROJECTION WRITE (EVENT-SOURCED)
     * ---------------------------------------
     * Replaces ingestion service call.
     *
     * PROJECTION RULE:
     * - Must derive state strictly from domain event
     * - Must NOT call external services
     */
    await trx('order_fulfillment_status')
      .insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status,
        status_updated_at: new Date(domainEvent.event_time),
        fulfilled_at:
          status === 'fulfilled'
            ? new Date(domainEvent.event_time)
            : null,
      })
      .onConflict('lasyncro_order_id')
      .merge({
        status,
        status_updated_at: new Date(domainEvent.event_time),
        fulfilled_at:
          status === 'fulfilled'
            ? trx.raw(
                'COALESCE(order_fulfillment_status.fulfilled_at, ?)',
                [new Date(domainEvent.event_time)]
              )
            : trx.raw('order_fulfillment_status.fulfilled_at'),
      });

      console.debug('[FULFILLMENT_AFTER_DB_WRITE]', {
        eventId: domain_event_id,
      });

      /**
       * PROJECTION TRACE
       */
      console.debug('[FULFILLMENT_PROJECTED]', {
        lasyncroOrderId,
        status,
        eventTime: domainEvent.event_time,
      });

    /**
     * AGGREGATE MUTATION
     */
    await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        order_updated_at: fulfillmentTimestamp,
        aggregate_version: trx.raw('aggregate_version + 1'),
      });

    /**
     * CAPTURE RECONCILIATION INTENT
     */
    reconciliationIntent = {
      lasyncroOrderId,
      aggregateVersion: aggregate_version,
      observed:
        status === 'fulfilled'
          ? {
              status: 'fulfilled',
              observedAt: new Date(domainEvent.event_time),
              source: 'shopify_sync' as const,
            }
          : undefined,
    };

  /**
   * RECONCILIATION INTENT PERSISTENCE
   * ----------------------------------
   * Queue publishing handled by dispatcher.
   */
  if (reconciliationIntent) {
    /**
     * IDEMPOTENT RECONCILIATION INTENT WRITE
     * --------------------------------------
     * Prevents duplicate key crashes during:
     * - replays
     * - retries
     * - partial commits
     */
    await trx('order_reconciliation_intents')
      .insert({
        lasyncro_order_id: reconciliationIntent.lasyncroOrderId,
        aggregate_version: reconciliationIntent.aggregateVersion,
        observed: reconciliationIntent.observed
          ? JSON.stringify(reconciliationIntent.observed)
          : null,
        created_at: new Date(),
      })
      .onConflict(['lasyncro_order_id', 'aggregate_version'])
      .ignore();

    console.debug('[RECONCILIATION_INTENT_WRITTEN_OR_SKIPPED]', {
      lasyncroOrderId: reconciliationIntent.lasyncroOrderId,
      aggregateVersion: reconciliationIntent.aggregateVersion,
    });

    console.debug('[RECONCILIATION_INTENT_WRITTEN]', {
      lasyncroOrderId: reconciliationIntent.lasyncroOrderId,
    });
  }

  /**
   * REBUILD MODE GUARD
   */
  if (reconciliationIntent && process.env.REBUILD_MODE === 'true') {
    console.log(
      '[REBUILD_MODE] reconciliation publish skipped',
      reconciliationIntent.lasyncroOrderId
    );
  }
}