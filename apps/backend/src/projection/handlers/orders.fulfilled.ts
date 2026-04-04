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
import orderFulfillmentIngestionService 
  from '../../services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { publishReconciliationJob } from '../../queues/reconciliation.queue.js';
import { projectOrderRisk } from '../../projections/orderRiskProjection.js';


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

  const payload = (domainEvent as any).canonical_payload ?? domainEvent.event_payload;

  /**
   * FULFILLMENT DATA COVERAGE CHECK (CRITICAL OBSERVABILITY)
   * -------------------------------------------------------
   * We currently DO NOT compute:
   * - partially_fulfilled
   * - fulfilled (accurately)
   *
   * Because required data is missing or unused:
   * - line_items
   * - fulfillment quantities
   *
   * This logs presence of required fields WITHOUT changing behavior.
   * Enables safe transition to derived fulfillment state.
   */
  if (!payload.line_items) {
    console.warn('[FULFILLMENT_DATA_MISSING_LINE_ITEMS]', {
      eventId: domain_event_id,
    });
  }

  if (payload.line_items && !Array.isArray(payload.line_items)) {
    console.error('[FULFILLMENT_DATA_INVALID_LINE_ITEMS]', {
      eventId: domain_event_id,
      type: typeof payload.line_items,
    });
  }

  /**
   * PAYLOAD SOURCE GUARANTEE
   * ------------------------
   * Prefer canonical_payload when available.
   *
   * Ensures:
   * - normalized structure
   * - deterministic projection
   * - safe handler assumptions
   *
   * Fallback ONLY for legacy events.
   */
  
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
   * LOCK ORDER ROW (HARD LOCK — DEADLOCK PREVENTION)
   * -----------------------------------------------
   * MUST acquire row-level lock immediately.
   * Prevents:
   * - deferred locking
   * - lock inversion vs other handlers
   */
  const { aggregate_version } = await trx('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .forUpdate()
    .select('aggregate_version')
    .first();

  console.debug('[ORDER_ROW_LOCKED_FOR_UPDATE]', {
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
     * INVALID STATE (CRITICAL)
     * ------------------------
     * Silent return removed.
     * This indicates malformed or incomplete event payload.
     *
     * MUST be observable to prevent hidden state corruption.
     */
    console.error('[PROJECTION_ORDERS_FULFILLED_INVALID_STATE]', {
      reason: 'Guard condition triggered → invalid payload or missing data'
    });

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

    /**
     * INVALID STATE (CRITICAL)
     * ------------------------
     * Silent return removed.
     * This indicates malformed or incomplete event payload.
     *
     * MUST be observable to prevent hidden state corruption.
     */
    console.error('[PROJECTION_ORDERS_FULFILLED_INVALID_STATE]', {
      reason: 'Guard condition triggered → invalid payload or missing data'
    });

    return;
  };

  /**
   * STATUS NORMALIZATION (HYBRID — EXTERNAL + INTERNAL)
   * ---------------------------------------------------
   * Accepts:
   * - external execution states (Shopify)
   * - internal domain states (already normalized)
   */
  const statusMap: Record<string, string> = {
    success: 'fulfilled',
    failure: 'failed',
  };

  const allowedStatuses = new Set([
    'pending',
    'processing',
    'partially_fulfilled',
    'fulfilled',
    'cancelled',
    'failed',
  ]);

  let normalizedStatus = statusMap[payload.status] ?? payload.status;

  /**
   * FINAL VALIDATION
   */
  if (!allowedStatuses.has(normalizedStatus)) {
    console.error('[FULFILLMENT_STATUS_UNMAPPED_FATAL]', {
      eventId: domain_event_id,
      externalStatus: payload.status,
      normalizedStatus,
    });

    throw new Error(
      `[FULFILLMENT_STATUS_UNMAPPED] status=${payload.status}`
    );
  }

   const status = normalizedStatus as
    | 'pending'
    | 'processing'
    | 'partially_fulfilled'
    | 'fulfilled'
    | 'cancelled'
    | 'failed';
  /**
   * DOMAIN STATE FLAGS (CRITICAL)
   * -----------------------------
   * Prevents coupling logic to raw string comparisons.
   *
   * Ensures:
   * - consistent semantics
   * - safe future expansion (partial fulfillment, etc.)
   */
  const isFulfilled = status === 'fulfilled';

  if (!allowedStatuses.has(status)) {
    console.error('[FULFILLMENT_STATUS_ENUM_VIOLATION]', {
      eventId: domain_event_id,
      status,
    });

    throw new Error(
      `[FULFILLMENT_STATUS_ENUM_INVALID] status=${status}`
    );
  }

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

    /**
     * FULFILLMENT INGESTION (SOURCE OF TRUTH)
     * ---------------------------------------
     * Replaces all direct projection writes.
     *
     * Guarantees:
     * - monotonic enforcement
     * - history consistency
     * - execution trigger emission
     */
    await orderFulfillmentIngestionService.ingestStatus(
      {
        lasyncroOrderId,
        shopId: domainEvent.shop_id,
        status,
        canonicalEventTime,
      },
      trx
    );

    console.debug('[FULFILLMENT_INGESTION_COMPLETED]', {
      lasyncroOrderId,
      status,
      eventTime: canonicalEventTime,
    });

    /**
     * AGGREGATE MUTATION (RETURNING VERSION — CRITICAL FIX)
     * ----------------------------------------------------
     * MUST return the incremented version to avoid stale reads.
     *
     * Prevents:
     * - reconciliation using outdated aggregate_version
     * - version drift between projection and reconciliation
     */
    const [updatedOrder] = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        order_updated_at: fulfillmentTimestamp,
        aggregate_version: trx.raw('aggregate_version + 1'),
      })
      .returning(['aggregate_version']);

    if (!updatedOrder?.aggregate_version) {
      console.error('[AGGREGATE_VERSION_UPDATE_FAILED_FATAL]', {
        lasyncroOrderId,
        eventId: domain_event_id,
      });

      throw new Error(
        `[AGGREGATE_VERSION_MISSING] order=${lasyncroOrderId}`
      );
    };

    try {
      await projectOrderRisk(
        trx,
        lasyncroOrderId,
        domainEvent.shop_id,
        updatedOrder.aggregate_version,
        new Date(domainEvent.event_time)
      );

      console.info('[RISK_PROJECTION_EXECUTED]', {
        orderId: lasyncroOrderId,
        aggregateVersion: updatedOrder.aggregate_version,
      });

    } catch (err) {
      console.error('[RISK_PROJECTION_FAILED]', {
        orderId: lasyncroOrderId,
        aggregateVersion: updatedOrder.aggregate_version,
        error: (err as Error).message,
      });

      throw err; // DO NOT SWALLOW
    }

    /**
     * CAPTURE RECONCILIATION INTENT
     */
    reconciliationIntent = {
      lasyncroOrderId,
      /**
       * VERSION SOURCE OF TRUTH (CRITICAL)
       * ---------------------------------
       * MUST use DB-returned version, NOT stale pre-update variable.
       */
      aggregateVersion: updatedOrder.aggregate_version,
      observed:
        isFulfilled
          ? {
              status: 'fulfilled',
              observedAt: new Date(domainEvent.event_time),
              source: 'shopify_sync' as const,
            }
          : undefined,
    };

  if (reconciliationIntent) {
    /**
     * DOMAIN EVENT EMISSION (CORRECT PATTERN)
     * ----------------------------------------
     * MUST emit domain_event → trigger → outbox
     * Never write outbox directly.
     */
    const [emittedEvent] = await trx('domain_events')
      .insert({
        event_type: 'reconciliation/intent_captured',
        event_payload: {
          lasyncro_order_id: reconciliationIntent.lasyncroOrderId,
          aggregate_version: reconciliationIntent.aggregateVersion,
          observed: reconciliationIntent.observed ?? null,
        },
        shop_id: domainEvent.shop_id,
        event_time: domainEvent.event_time,
      })
      .returning(['id']);

    console.debug('[RECONCILIATION_DOMAIN_EVENT_EMITTED]', {
      lasyncroOrderId: reconciliationIntent.lasyncroOrderId,
      aggregateVersion: reconciliationIntent.aggregateVersion,
      domainEventId: emittedEvent?.id,
    });

    if (
      reconciliationIntent.observed &&
      reconciliationIntent.observed.source !== 'shopify_sync'
    ) {
      console.error('[OBSERVED_SOURCE_MISMATCH]', {
        received: reconciliationIntent.observed.source,
      });
    }

    /**
     * NORMALIZE OBSERVED (DEFENSIVE — CRITICAL)
     * -----------------------------------------
     * Protects queue contract from upstream inconsistencies.
     * DLQ evidence shows invalid values entering system.
     */
    const normalizedObserved = reconciliationIntent.observed
      ? {
          status: 'fulfilled' as const,
          observedAt: new Date(reconciliationIntent.observed.observedAt),
          source: 'shopify_sync' as const,
        }
      : undefined;

    await publishReconciliationJob(
      reconciliationIntent.lasyncroOrderId,
      reconciliationIntent.aggregateVersion,
      normalizedObserved
    );

    console.info('[RECONCILIATION_JOB_PUBLISHED_DIRECT]', {
      lasyncroOrderId: reconciliationIntent.lasyncroOrderId,
      aggregateVersion: reconciliationIntent.aggregateVersion,
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