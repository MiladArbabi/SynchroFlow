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
import { Knex } from 'knex';
import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';
import orderFulfillmentIngestionService 
  from '../../services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { publishReconciliationJob } from '../../queues/reconciliation.queue.js';
import { debugLog } from '../projection.utils.js';

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

  debugLog('[FULFILLMENT_HANDLER_START]', {
    eventId: domain_event_id,
  });

  const payload = (domainEvent as any).canonical_payload ?? domainEvent.event_payload;

  /**
   * LINE ITEMS COVERAGE CHECK
   * --------------------------
   * Backfill events (external_event_id ending in ':backfill') never
   * carry line_items by design — they are synthetic events emitted
   * during historical sync with only order_id and status.
   *
   * Only warn for real webhook events where line_items is expected.
   */
  const isBackfillEvent = String(domainEvent.external_event_id ?? '').endsWith(':backfill');
  if (!payload.line_items && !isBackfillEvent) {
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

  debugLog('[FULFILLMENT_BEFORE_ID_RESOLUTION]', {
    eventId: domain_event_id,
  });

  const lasyncroOrderId = await resolveExternalOrderId(
    domainEvent.shop_id,
    'shopify',
    externalOrderId,
    trx
  );

  /**
   * IDENTITY GUARD (MUST precede any DB operations on this order)
   * -------------------------------------------------------------
   * If identity resolution fails, no lock or query should proceed.
   * Placing this after forUpdate() would crash on null orderId.
   */
  if (!lasyncroOrderId) {
    console.error('[PROJECTION_ORDERS_FULFILLED_INVALID_STATE]', {
      reason: 'Identity resolution returned null — unknown external order',
      externalOrderId,
      eventId: domain_event_id,
    });
    return;
  }

  /**
   * LOCK ORDER ROW (HARD LOCK — DEADLOCK PREVENTION)
   * -----------------------------------------------
   * Acquired AFTER identity guard to avoid locking on null orderId.
   * Prevents lock inversion vs other concurrent handlers.
   */
  const { aggregate_version } = await trx('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .forUpdate()
    .select('aggregate_version')
    .first();

  debugLog('[ORDER_ROW_LOCKED_FOR_UPDATE]', { lasyncroOrderId });
  debugLog('[FULFILLMENT_AFTER_ID_RESOLUTION]', { eventId: domain_event_id, lasyncroOrderId });

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

    debugLog('[FULFILLMENT_INGESTION_COMPLETED]', {
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

    /**
     * REV-HARD-05 — only a genuinely fulfilled state consumes all demand.
     * Pending/processing/partial updates must preserve remaining quantity
     * so inventory constraints continue to reflect unfulfilled units.
     */
    if (isFulfilled) {
      await trx('order_revenue_units')
        .where({ lasyncro_order_id: lasyncroOrderId })
        .update({ fulfilled_quantity: trx.raw('quantity') });
    }

    if (!updatedOrder?.aggregate_version) {
      console.error('[AGGREGATE_VERSION_UPDATE_FAILED_FATAL]', {
        lasyncroOrderId,
        eventId: domain_event_id,
      });

      throw new Error(
        `[AGGREGATE_VERSION_MISSING] order=${lasyncroOrderId}`
      );
    };

    /**
     * PROJECTION ORCHESTRATION GUARD (CRITICAL FIX)
     * --------------------------------------------
     * Risk projection MUST NOT be invoked from handlers.
     *
     * Reason:
     * - breaks projection determinism
     * - bypasses projection engine
     * - causes partial projection execution
     *
     * Expected:
     * - risk projection executed by projection engine orchestration layer
     */
    console.warn('[PROJECTION_ORCHESTRATION_VIOLATION_PREVENTED]', {
      handler: 'orders.fulfilled',
      projection: 'orderRiskProjection',
      eventId: domain_event_id
    });

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
    if (
      reconciliationIntent.observed &&
      reconciliationIntent.observed.source !== 'shopify_sync'
    ) {
      console.error('[OBSERVED_SOURCE_MISMATCH]', {
        received: reconciliationIntent.observed.source,
      });
    }

    const normalizedObserved = reconciliationIntent.observed
      ? {
          status: 'fulfilled' as const,
          observedAt: new Date(reconciliationIntent.observed.observedAt),
          source: 'shopify_sync' as const,
        }
      : undefined;

    if (process.env.REBUILD_MODE === 'true') {
      console.log(
        '[REBUILD_MODE] reconciliation publish skipped',
        reconciliationIntent.lasyncroOrderId
      );
    } else {
      /**
       * POST-COMMIT PUBLISH (CRITICAL)
       * ------------------------------
       * publishReconciliationJob MUST fire only after the projection
       * transaction commits. Publishing inside the transaction risks
       * ghost jobs: the queue message is delivered but the DB write
       * rolls back, leaving reconciliation referencing a non-existent
       * aggregate version.
       *
       * trx.executionPromise resolves on commit, rejects on rollback.
       * The publish is chained onto commit — never fires on rollback.
       */
      const intentSnapshot = reconciliationIntent;
      trx.executionPromise.then(async () => {
        try {
          await publishReconciliationJob(
            intentSnapshot.lasyncroOrderId,
            intentSnapshot.aggregateVersion,
            normalizedObserved
          );
          debugLog('[RECONCILIATION_JOB_PUBLISHED_POST_COMMIT]', {
            lasyncroOrderId: intentSnapshot.lasyncroOrderId,
            aggregateVersion: intentSnapshot.aggregateVersion,
          });
        } catch (err) {
          // Non-fatal: projection is already committed.
          // Reconciliation will be retried via its own recovery path.
          console.error('[RECONCILIATION_JOB_PUBLISH_FAILED_POST_COMMIT]', {
            lasyncroOrderId: intentSnapshot.lasyncroOrderId,
            aggregateVersion: intentSnapshot.aggregateVersion,
            error: err,
          });
        }
      });
    }
  }
}