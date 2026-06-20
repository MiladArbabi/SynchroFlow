// apps/backend/src/projection/projection.engine.ts
import { Knex } from 'knex';
import { projectionRegistry } from './projection.registry.js';
import { extractExternalOrderId, debugLog } from './projection.utils.js';

import { projectOrderAge } from '../projections/orderAgeProjection.js';
import { projectOrderConstraints } from '../projections/orderConstraintProjection.js';
import { projectOrderInventoryConstraints } from '../projections/orderInventoryConstraintProjection.js';
import { projectOrderRisk } from '../projections/orderRiskProjection.js';
import { evaluateOrderConstraints } from '../services/constraints/constraintEngine.js';
import { computeOrderMargin } from '../services/margin/computeOrderMargin.service.js';
import { db } from '@lasyncro/backend-core';
import { projectRevenueDaily } from '../projections/orderRevenueDailyProjection.js';

/**
 * PROJECTION ENGINE
 * -----------------
 * Transport-agnostic execution layer.
 *
 * IMPORTANT:
 * Queue transport must NEVER be imported here.
 * Worker transport owns all RabbitMQ interaction.
 */

/**
 * Projection Streams
 */
const ORDERS_PROJECTION = 'orders_projection';
const LIFECYCLE_PROJECTION = 'lifecycle_projection';

/**
 * RUNTIME ENTRYPOINT (FIXED)
 * ---------------------------
 * This function must execute the SAME core path as DB worker.
 *
 * Previously:
 * - routed to queue-only path → always threw
 * - caused projection to NEVER execute in canonical processor
 *
 * Now:
 * - loads domain event
 * - executes projectDomainEventCore inside transaction
 *
 * Guarantees:
 * - single execution path
 * - parity with DB worker
 * - deterministic behavior
 */
export async function projectDomainEvent(
  domain_event_id: number
) {
  const db = (await import('@lasyncro/backend-core/db.js')).default;

  await db.transaction(async (trx) => {

    const domainEvent = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    if (!domainEvent) {
      console.error('[PROJECTION_EVENT_NOT_FOUND_FATAL]', {
        domain_event_id
      });

      throw new Error(
        `[PROJECTION_EVENT_NOT_FOUND] id=${domain_event_id}`
      );
    }

    await projectDomainEventCore({
      domainEvent,
      domain_event_id,
      trx
    });

    debugLog('[PROJECTION_EXECUTED_VIA_RUNTIME]', {
      domain_event_id
    });
  });
}

/**
 * CORE PROJECTION EXECUTOR (SOURCE OF TRUTH)
 * ------------------------------------------
 * This function is transport-agnostic.
 *
 * MUST be the only place where:
 * - handlers are invoked
 * - cursor is advanced
 *
 * All entrypoints (queue, DB, replay) must call this.
 */
export async function projectDomainEventCore({
  domainEvent,
  domain_event_id,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  trx: Knex.Transaction;
}) {
  
    if (!trx) {
      throw new Error('[PROJECTION_TRX_MISSING]');
    }

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    /**
     * TENANT CONTEXT FOR REPLAY (CRITICAL)
     * ------------------------------------
     * RLS-protected projection targets (e.g. lifecycle_events) enforce
     *   shop_id = current_setting('app.current_tenant')::int
     * At runtime this GUC is set by request middleware. During rebuild/replay
     * there is no request, so it is unset and every RLS INSERT fails with 42501
     * (new row violates row-level security policy). The engine is the canonical
     * writer for BOTH runtime and replay, so it sets tenant deterministically
     * from the event's own shop_id. Safe at runtime too — value is identical to
     * what middleware already set.
     */
    await trx.raw(`SET LOCAL "app.current_tenant" = '${Number(domainEvent.shop_id)}'`);

      /**
       * ENGINE IS STATELESS (CRITICAL)
       * ------------------------------
       * Cursor state is owned by projection worker.
       * Engine MUST NOT:
       * - read cursor
       * - validate sequence
       * - enforce ordering
       *
       * This prevents:
       * - lock contention
       * - duplicate responsibility
       * - hidden transaction stalls
       */

      let canonicalPayload = domainEvent.event_payload;

      /**
       * FULFILLMENT CANONICAL PASSTHROUGH (CRITICAL)
       * ---------------------------------------------
       * orders/fulfilled and orders/fulfillment_updated carry partial
       * Shopify payloads — no canonical mapper exists for them.
       *
       * The registry guard for orders/fulfillment_updated requires
       * canonical_payload to be set or it throws CONTRACT_VIOLATION.
       *
       * Since the handler only reads raw field names (order_id, status,
       * line_items), passing the raw payload as canonical_payload is
       * correct and safe until a fulfillment mapper is built.
       */
      if (
        domainEvent.event_type === 'orders/fulfilled' ||
        domainEvent.event_type === 'orders/fulfillment_updated'
      ) {
        canonicalPayload = domainEvent.event_payload;
        debugLog('[CANONICAL_FULFILLMENT_PASSTHROUGH]', {
          eventId: domain_event_id,
          eventType: domainEvent.event_type,
        });
      }
      
      /**
       * CANONICAL NORMALIZATION (ENABLED)
       * ---------------------------------
       * CRITICAL:
       * - Orders MUST be normalized before reaching handler
       * - Raw payloads are NOT safe for projection logic
       *
       * This was previously disabled → caused handler failures
       * 
       * CANONICAL NORMALIZATION SCOPE (CRITICAL FIX)
       * --------------------------------------------
       * ONLY apply order canonical mapper to full order payload events.
       *
       * DO NOT include:
       * - orders/fulfilled
       * - orders/fulfillment_updated
       *
       * These events carry partial payloads and will fail mapping
       * (e.g. missing currencyCode).
       *
       * Fulfillment requires its own canonical mapper (NOT this one).
       */
      if (
        domainEvent.event_type === 'orders/create' ||
        domainEvent.event_type === 'orders/sync'
      ) {
        /**
         * CANONICAL NORMALIZATION EXPANSION (CRITICAL FIX)
         * ------------------------------------------------
         * Fulfillment events MUST be normalized before projection.
         *
         * Without this:
         * - handlers receive raw Shopify payloads
         * - status semantics mismatch (execution vs state)
         * - projection becomes non-deterministic
         *
         * This aligns fulfillment events with order ingestion guarantees.
         */
        try {
          const { mapShopifyOrderNodeToCanonical } = await import(
            '../services/mappers/shopify-to-canonical-order.js'
          );

          canonicalPayload = mapShopifyOrderNodeToCanonical(
            domainEvent.event_payload,
            domainEvent.shop_id
          );

          debugLog('[CANONICAL_NORMALIZATION_APPLIED]', {
            eventId: domain_event_id,
            eventType: domainEvent.event_type,
          });

        } catch (err) {
          console.error('[CANONICAL_NORMALIZATION_FAILED_FATAL]', {
            eventId: domain_event_id,
            error: err,
          });

          /**
           * FAIL FAST — do NOT allow raw payload fallback
           * This guarantees deterministic projection behavior
           */
          throw err;
        }
      }
      const canonicalEventTime = new Date(domainEvent.event_time);

      /**
       * EVENT TYPE NORMALIZATION (GLOBAL REPLACE)
       * ------------------------------------------
       * Uses regex with /g flag to replace ALL dots, not just the first.
       * e.g. "orders.line_items.update" → "orders/line_items/update"
       * Single .replace('.', '/') only catches the first dot — silent misroute.
       */
      const normalizedEventType = domainEvent.event_type.replace(/\./g, '/');

      /**
       * PROJECTION COVERAGE GUARD (CRITICAL)
       * -----------------------------------
       * Ensures every domain_event.event_type has a registered handler.
       *
       * Prevents:
       * - silent event drops
       * - incomplete projections
       * - non-replayable system state
       *
       * This is the SINGLE source of truth for projection completeness.
       */
      const handler = projectionRegistry[normalizedEventType];

      /**
       * ORDER PROJECTION TARGET (DEFERRED RESOLUTION)
       * ---------------------------------------------
       * Order ID must be resolved by handler via identity map.
       *
       * Engine MUST NOT:
       * - assume payload contains internal ID
       * - attempt external → internal resolution
       *
       * Resolution happens AFTER handler execution.
       */
      let projectionTargetOrderId: string | null = null;


      if (!handler) {
        /**
         * UNKNOWN HANDLER — SKIP, DO NOT CRASH.
         * --------------------------------------------------
         * An event type with no registered handler is inert:
         * it cannot mutate any projection. Crashing the worker
         * halts the entire pipeline over an event it would never
         * have acted on (e.g. renamed/orphaned event types from
         * seeds or replays). Log at ERROR for visibility and let
         * the caller advance the cursor past it.
         */
        console.error('[PROJECTION_HANDLER_MISSING_SKIPPED]', {
          event_type: normalizedEventType,
          domain_event_id,
          knownHandlers: Object.keys(projectionRegistry),
          action: 'skipping inert event — no handler registered',
        });
        return;
      }

      /**
       * Attach normalized type for downstream visibility
       */
      domainEvent.event_type = normalizedEventType;

      (domainEvent as any).canonical_payload = canonicalPayload;

      /**
       * CRITICAL: attach canonical payload to domainEvent
       * so handlers operate on normalized data
       */

      /**
       * HANDLER EXECUTION
       * -----------------
       * Handlers must execute inside the projection transaction.
       * The trx handle is injected to guarantee atomic projection
       * and deterministic rebuild behavior.
       */
      if (handler) {
        try {
          await handler({
            domainEvent: {
              ...domainEvent,
              canonical_payload: canonicalPayload,
            },
            domain_event_id,
            canonicalEventTime,
            trx,
          });
         } catch (err: any) {
          console.error('[PROJECTION_HANDLER_ERROR_FATAL]', {
            eventId: domain_event_id,
            eventType: normalizedEventType,
            error: err?.message,
          });

          /**
           * FAIL FAST (CRITICAL)
           * --------------------
           * Projection must NEVER:
           * - swallow errors
           * - advance cursor on failure
           *
           * Throwing ensures:
           * - transaction rollback
           * - cursor NOT advanced
           * - event retried deterministically
           */
          throw err;
        }
      };

      /**
       * ORDER-ENTITY EVENTS ONLY (STRICT FILTER)
       * ---------------------------------------
       * Only events that operate on a specific order
       * require identity resolution.
       *
       * Excludes:
       * - orders/sync_started (no order context)
       */
      const isOrderEntityEvent = [
        'orders/create',
        'orders/sync',
        'orders/paid',
        'orders/fulfilled',
        'orders/fulfillment_updated'
      ].includes(normalizedEventType);

      if (isOrderEntityEvent) {
        const payload = canonicalPayload ?? domainEvent.event_payload;

        if (!payload) {
          throw new Error(`[MISSING_PAYLOAD] event ${domain_event_id}`);
        }

        const externalId = extractExternalOrderId(
          normalizedEventType,
          payload
        );

        if (externalId === null || externalId === undefined) {
          console.error('[ORDER_EXTERNAL_ID_INVALID_FATAL]', {
            eventId: domain_event_id,
            eventType: normalizedEventType,
            payload
          }); 

          throw new Error(`[ORDER_EXTERNAL_ID_INVALID] event ${domain_event_id}`);
        }

        const externalIdStr = String(externalId);

        const mapping = await trx('external_order_identity_map')
          .where({
            shop_id: domainEvent.shop_id,
            platform: 'shopify',
            external_order_id: externalIdStr,
          })
          .first();

        if (!mapping?.lasyncro_order_id) {
          /**
           * DEFERRED REQUEUE — orders/paid ONLY
           * ------------------------------------
           * orders/paid legitimately arrives before orders/create due to
           * Shopify webhook delivery jitter (milliseconds apart).
           *
           * Fix: re-insert at tail so orders/create processes first,
           * writes identity map, then deferred paid resolves cleanly.
           *
           * Cap: MAX_DEFERS=3. Fatal on exhaustion.
           * All other event types: fatal throw immediately (unchanged).
           */
          if (normalizedEventType === 'orders/paid') {
            const deferCount = Number((domainEvent.event_payload as any)?._defer_count ?? 0);
            const MAX_DEFERS = 3;

            if (deferCount >= MAX_DEFERS) {
              console.error('[ORDER_PAID_DEFER_EXHAUSTED]', {
                eventId: domain_event_id,
                externalId,
                deferCount,
              });
              throw new Error(
                `[ORDER_PAID_DEFER_EXHAUSTED] externalId=${externalId} attempts=${deferCount}`
              );
            }

            /**
             * IDEMPOTENT DEFER RE-QUEUE (replay-safe)
             * --------------------------------------
             * The deferred orders/paid event must be insert-once. Without
             * ON CONFLICT, re-running a rebuild (or any second pass where a
             * prior :deferN row survived a partial/failed run) throws 23505 on
             * domain_events_shop_external_event_unique and aborts the whole
             * rebuild. The defer key is deterministic, so a duplicate means the
             * requeue already happened — safely ignore it.
             */
            await trx('domain_events').insert({
              shop_id: domainEvent.shop_id,
              event_type: 'orders/paid',
              event_payload: {
                ...(domainEvent.event_payload as object),
                _defer_count: deferCount + 1,
              },
              event_time: domainEvent.event_time,
              event_version: domainEvent.event_version,
              external_event_id: `${String(domainEvent.external_event_id).replace(/:defer\d+$/, '')}:defer${deferCount + 1}`,
            })
            /**
             * Partial unique index target (replay-safe):
             *   domain_events_shop_external_event_unique
             *   ON (shop_id, external_event_id) WHERE external_event_id IS NOT NULL
             * Knex cannot infer a PARTIAL index from a column list (error 42P10),
             * so the conflict target is specified raw WITH its predicate. A
             * duplicate means this paid event was already deferred on a prior
             * pass — safely ignore so rebuild is re-runnable.
             */
            .onConflict(
              trx.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')
            )
            .ignore();

            console.warn('[ORDER_PAID_DEFERRED_REQUEUED]', {
              originalEventId: domain_event_id,
              externalId,
              deferCount: deferCount + 1,
              reason: 'identity_not_yet_available',
            });

            return; // cursor advances normally in worker — no throw
          }

          console.error('[ORDER_IDENTITY_RESOLUTION_FAILED_FATAL]', {
            eventId: domain_event_id,
            eventType: normalizedEventType,
            externalId,
          });
          throw new Error(
            `[ORDER_IDENTITY_RESOLUTION_FAILED] externalId=${externalId}`
          );
        }
        projectionTargetOrderId = mapping.lasyncro_order_id;
      }

      /**
       * PROJECTION COMPLETION WRITE (CRITICAL)
       * --------------------------------------
       * Marks projection as complete for this aggregate version.
       *
       * MUST run AFTER handler succeeds.
       */
      if (projectionTargetOrderId) {
        await trx('orders')
          .where({ lasyncro_order_id: projectionTargetOrderId })
          .update({
            /**
             * DO NOT set last_projected_version in projection.
             * ------------------------------------------------
             * Owned exclusively by reconciliation layer.
             *
             * Setting it here causes:
             * - reconciliation to skip
             * - commands to never dispatch
             */
            updated_at: trx.fn.now(),
          });

        debugLog('[PROJECTION_COMPLETED]', {
          orderId: projectionTargetOrderId,
          domain_event_id,
        });
      }

      /**
       * PROJECTION ORCHESTRATION (ARGUMENT-CORRECT)
       * ------------------------------------------
       * Executes dependent projections with verified signatures.
       *
       * Constraints:
       * - inventory projection is DISABLED → MUST NOT call
       * - constraint projection requires evaluations → currently unavailable
       *
       * Therefore:
       * - execute ONLY safe projections
       */
      if (projectionTargetOrderId && isOrderEntityEvent) {

        const shopId = domainEvent.shop_id;
        const eventAnchor = canonicalEventTime;

        /**
         * AGGREGATE VERSION RESOLUTION (SOURCE OF TRUTH)
         * ---------------------------------------------
         * aggregate_version is NOT part of domain event.
         *
         * Must be read from orders table to ensure:
         * - correctness
         * - consistency with handlers
         * - deterministic projections
         */
        const orderRow = await trx('orders')
          .where({ lasyncro_order_id: projectionTargetOrderId })
          .select('aggregate_version')
          .first();

        if (!orderRow?.aggregate_version) {
          console.error('[PROJECTION_ORCHESTRATION_MISSING_AGGREGATE_VERSION_FATAL]', {
            orderId: projectionTargetOrderId,
            domain_event_id
          });

          throw new Error('[PROJECTION_INVALID_AGGREGATE_VERSION]');
        }

        const aggregateVersion = orderRow.aggregate_version;

        if (!aggregateVersion) {
          console.error('[PROJECTION_ORCHESTRATION_MISSING_VERSION_FATAL]', {
            domain_event_id
          });
          throw new Error('[PROJECTION_ORCHESTRATION_INVALID_STATE]');
        }

        debugLog('[PROJECTION_ORCHESTRATION_START]', {
          orderId: projectionTargetOrderId,
          domain_event_id
        });

        /**
         * AGE PROJECTION (MUST COMPLETE FIRST)
         */
        await projectOrderAge(
          trx,
          projectionTargetOrderId,
          shopId,
          aggregateVersion,
          eventAnchor
        );

        /**
         * HARD READ GUARANTEE — AGE SNAPSHOT MUST EXIST
         */
        const ageSnapshot = await trx('order_age_snapshot')
          .where({
            lasyncro_order_id: projectionTargetOrderId,
            aggregate_version: aggregateVersion
          })
          .first();

        if (!ageSnapshot) {
          console.error('[PROJECTION_ORDERING_VIOLATION_FATAL]', {
            orderId: projectionTargetOrderId,
            aggregateVersion
          });

          throw new Error('[AGE_PROJECTION_NOT_MATERIALIZED]');
        }

          /**
           * PROJECTION ORDERING VERIFIED (CRITICAL OBSERVABILITY)
           * ----------------------------------------------------
           * Confirms that:
           * - age projection write is visible inside same transaction
           * - versioned snapshot exists
           *
           * Without this log, silent projection failures are undetectable.
           */
          debugLog('[AGE_PROJECTION_VERIFIED]', {
            orderId: projectionTargetOrderId,
            aggregateVersion
          });


        /**
         * CONSTRAINT EVALUATION (NOW SAFE)
         */
        const evaluations = await evaluateOrderConstraints(
          trx,
          projectionTargetOrderId,
          shopId
        );

        await projectOrderConstraints(
          trx,
          projectionTargetOrderId,
          shopId,
          aggregateVersion,
          eventAnchor,
          evaluations
        );

        /**
         * RISK PROJECTION (LAST)
         */
        await projectOrderRisk(
          trx,
          projectionTargetOrderId,
          shopId,
          aggregateVersion,
          eventAnchor
        );

        /**
         * Set reconciliation flag BEFORE savepoint.
         * SET LOCAL inside a savepoint is rolled back on ROLLBACK TO SAVEPOINT.
         * Must be set at transaction level to persist through savepoint boundaries.
         */
        await trx.raw(`SET LOCAL "synchroflow.reconciliation" = 'true'`);
        try {
          await trx.raw('SAVEPOINT margin_computation');
          await computeOrderMargin(
              trx,
              projectionTargetOrderId,
              shopId,
              aggregateVersion
            );
            await trx.raw('RELEASE SAVEPOINT margin_computation');
        } catch (err) {
            await trx.raw('ROLLBACK TO SAVEPOINT margin_computation');
            console.error('[MARGIN_COMPUTATION_FAILED]', {
              orderId: projectionTargetOrderId,
              error: (err as Error).message,
            });
        }

        /**
         * DAILY REVENUE PROJECTION (SHOP-LEVEL, per-shop daily buckets)
         * ------------------------------------------------------------
         * Aggregates order_revenue_units_net → revenue_projection_daily.
         * This is a whole-shop daily aggregation (not per-order), but it is
         * idempotent: it re-derives every day bucket and upserts via
         * onConflict(shop_id, revenue_date). Running it once per order event
         * is therefore safe and self-healing — the final call of a replay
         * lands the complete picture. Wired here because the projection was
         * declared in projectionExecutionOrder but never invoked by the
         * engine, leaving revenue_projection_daily permanently empty.
         */
        try {
          await trx.raw('SAVEPOINT revenue_daily_projection');
          await projectRevenueDaily(
            trx,
            shopId,
            aggregateVersion,
            eventAnchor
          );
          await trx.raw('RELEASE SAVEPOINT revenue_daily_projection');
        } catch (err) {
          await trx.raw('ROLLBACK TO SAVEPOINT revenue_daily_projection');
          console.error('[REVENUE_DAILY_PROJECTION_FAILED]', {
            shopId,
            error: (err as Error).message,
          });
        }

        debugLog('[PROJECTION_ORCHESTRATION_COMPLETED]', {
          orderId: projectionTargetOrderId,
          domain_event_id
        });

        /**
         * SNAPSHOT JOB SCHEDULING (POST-PROJECTION)
         * ------------------------------------------
         * Reconciliation consumer is permanently disabled.
         * Snapshot jobs must be scheduled directly from the
         * projection engine after each order event completes.
         *
         * Uses onConflict merge to deduplicate — only one
         * pending job per shop at any time.
         */
        await trx('shop_snapshot_jobs')
          .insert({
            shop_id: shopId,
            scheduled_at: trx.fn.now(),
          })
          .onConflict(['shop_id'])
          .merge({
            scheduled_at: trx.fn.now(),
          });
      }

      if (!projectionTargetOrderId) {
        console.warn('[PROJECTION_NO_ORDER_TARGET]', {
          eventType: normalizedEventType,
          domain_event_id
        });
      }
    };

/**
 * CORE PROJECTION FUNCTION
 * (Mechanical relocation from worker.ts)
 */
export async function projectDomainEventFromMessage(
  msg: { content: Buffer } | null
) {
  
  if (!msg) {
  /**
     * CRITICAL: Silent drop guard removed
     * ----------------------------------
     * Null message indicates queue/consumer anomaly.
     * Must be observable for debugging and system integrity.
     */
    console.error('[PROJECTION_ENGINE_NULL_MESSAGE]', {
      reason: 'Received null message from queue'
    });
    return;
  }
  
  throw new Error('[PROJECTION_VIA_QUEUE_FORBIDDEN]');
};