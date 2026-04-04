// apps/backend/src/projection/projection.engine.ts
import { Knex } from 'knex';
import { projectionRegistry } from './projection.registry.js';
import { extractExternalOrderId } from './projection.utils.js';

import { projectOrderAge } from '../projections/orderAgeProjection.js';
import { projectOrderConstraints } from '../projections/orderConstraintProjection.js';
import { projectOrderInventoryConstraints } from '../projections/orderInventoryConstraintProjection.js';
import { projectOrderRisk } from '../projections/orderRiskProjection.js';
import { evaluateOrderConstraints } from '../services/constraints/constraintEngine.js';

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

    console.debug('[PROJECTION_EXECUTED_VIA_RUNTIME]', {
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

    /**
     * PROJECTION WRITE CONTEXT (CRITICAL)
     * -----------------------------------
     * Enables DB-level write access to projection tables.
     *
     * Required because:
     * - DB enforces single-writer invariant
     * - prevents non-engine writes
     */
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

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

          console.debug('[CANONICAL_NORMALIZATION_APPLIED]', {
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
       * EVENT TYPE NORMALIZATION (CRITICAL)
       * -----------------------------------
       * Prevents routing failures due to:
       * - slash vs dot drift
       * - external inconsistencies
       *
       * Canonical format: slash-delimited
       */
      const normalizedEventType = domainEvent.event_type.replace('.', '/');

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
        console.error('[PROJECTION_HANDLER_MISSING_FATAL]', {
          event_type: normalizedEventType,
          domain_event_id,
          knownHandlers: Object.keys(projectionRegistry)
        });

        throw new Error(
          `[PROJECTION_HANDLER_MISSING] event_type=${normalizedEventType}`
        );
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
          console.error('[ORDER_IDENTITY_RESOLUTION_FAILED_FATAL]', {
            eventId: domain_event_id,
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

        console.debug('[PROJECTION_COMPLETED]', {
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

        console.debug('[PROJECTION_ORCHESTRATION_START]', {
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

        console.debug('[PROJECTION_ORCHESTRATION_COMPLETED]', {
          orderId: projectionTargetOrderId,
          domain_event_id
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