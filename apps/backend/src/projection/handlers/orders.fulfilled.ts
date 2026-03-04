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
import OrderFulfillmentIngestionService from '../../services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { advanceCursor } from '../projection.engine.js';

const ORDERS_PROJECTION = 'orders_projection';

export async function handleOrdersFulfilled({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
}) {

  const payload = domainEvent.event_payload as any;
  const externalOrderId = String(payload.order_id);

  const lasyncroOrderId = await resolveExternalOrderId(
    domainEvent.shop_id,
    'shopify',
    externalOrderId
  );

  /**
   * MISSING AGGREGATE DETECTED
   * --------------------------
   * Emits deterministic signal for orchestration.
   * (Preserved exactly as original implementation.)
   */
  if (!lasyncroOrderId) {

    await db('domain_events').insert({
      shop_id: domainEvent.shop_id,
      event_type: 'orders/missing_detected',
      event_payload: {
        external_order_id: externalOrderId,
        source_event_id: domain_event_id,
        reason: 'fulfillment_before_aggregate'
      },
      event_time: domainEvent.event_time
    });

    console.warn('[MISSING_ORDER_DETECTED]', {
      externalOrderId,
      sourceEventId: domain_event_id
    });

    return;
  }

  /**
   * FULFILLMENT STATUS RESOLUTION
   */
  const status =
    payload.status === 'cancelled'
      ? 'cancelled'
      : 'fulfilled';

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

  await db.transaction(async (trx: Knex.Transaction) => {

    /**
     * TRANSACTIONAL MONOTONIC CURSOR ENFORCEMENT
     */
    const cursorRow = await trx('projection_cursors')
      .where({ projection_name: ORDERS_PROJECTION })
      .forUpdate()
      .first<{ last_processed_event_id: number }>();

    if (
      cursorRow?.last_processed_event_id != null &&
      domain_event_id <= cursorRow.last_processed_event_id
    ) {
      throw new Error(
        `[PROJECTION_ORDER_VIOLATION] last=${cursorRow.last_processed_event_id} got=${domain_event_id}`
      );
    }

    /**
     * FULFILLMENT INGESTION
     */
    await OrderFulfillmentIngestionService.ingestStatus(
      {
        lasyncroOrderId,
        status,
        canonicalEventTime: new Date(domainEvent.event_time),
      },
      trx
    );

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
     * FETCH CURRENT AGGREGATE VERSION
     */
    const { aggregate_version } = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select('aggregate_version')
      .first();

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

    const eventRow = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    await advanceCursor(
      trx,
      ORDERS_PROJECTION,
      domain_event_id,
      eventRow.event_time
    );
  });

  /**
   * RECONCILIATION INTENT PERSISTENCE
   * ----------------------------------
   * Queue publishing handled by dispatcher.
   */
  if (reconciliationIntent) {
    await db('order_reconciliation_intents').insert({
      lasyncro_order_id: reconciliationIntent.lasyncroOrderId,
      aggregate_version: reconciliationIntent.aggregateVersion,
      observed: reconciliationIntent.observed
        ? JSON.stringify(reconciliationIntent.observed)
        : null,
      created_at: new Date(), // preserved (non-deterministic)
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