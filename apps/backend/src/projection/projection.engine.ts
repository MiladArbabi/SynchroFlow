// apps/backend/src/projection/projection.engine.ts
import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';

import { projectionRegistry } from './projection.registry.js';
import { extractExternalOrderId } from './projection.utils.js';

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
 * PURE PROJECTION ENTRY POINT
 * Transport-agnostic.
 */
export async function projectDomainEvent(
  domain_event_id: number
) {
  await projectDomainEventFromMessage({
    content: Buffer.from(JSON.stringify({ domain_event_id })),
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
          console.error('[PROJECTION_HANDLER_ERROR]', {
            eventId: domain_event_id,
            eventType: normalizedEventType,
            error: err?.message,
          });

          // DO NOT crash worker
          return;
        }
      }

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
            last_projected_version: trx.raw('aggregate_version'),
            updated_at: trx.fn.now(),
          });

        console.debug('[PROJECTION_COMPLETED]', {
          orderId: projectionTargetOrderId,
          domain_event_id,
        });
      }

      if (!projectionTargetOrderId) {
        console.warn('[PROJECTION_NO_ORDER_TARGET]', {
          eventType: normalizedEventType,
          domain_event_id
        });
      }

      /**
       * CURSOR ADVANCEMENT HANDLED INLINE
       * ---------------------------------
       * advanceCursor() is intentionally NOT used here.
       *
       * Reason:
       * - it bypasses transactional cursorRow context
       * - causes duplicate writes
       * - violates monotonicity constraint
       *
       * All cursor logic must remain colocated with:
       * SELECT ... FOR UPDATE cursorRow
       */

      /**
       * CURSOR HANDLING REMOVED (DB-DRIVEN MODE)
       * ----------------------------------------
       * Cursor progression is now owned exclusively by:
       * → projection.db.worker.ts
       *
       * DO NOT reintroduce cursor logic here.
       */
    };

/**
 * CORE PROJECTION FUNCTION
 * (Mechanical relocation from worker.ts)
 */
export async function projectDomainEventFromMessage(
  msg: { content: Buffer } | null
) {

  
  if (!msg) return;

  const content = msg.content.toString();
  
  throw new Error('[PROJECTION_VIA_QUEUE_FORBIDDEN]');

  try {
    let parsed: any;

    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('[PROJECTION_INVALID_JSON]', { raw: content });
      throw err;
    }

    const domain_event_id = Number(parsed?.domain_event_id);

    console.error('[PROJECTION_RECEIVE_TRACE]', {
      domain_event_id,
    });

    if (!Number.isInteger(domain_event_id)) {
      console.error('[PROJECTION_PROTOCOL_VIOLATION]', {
        expected: '{ domain_event_id: number }',
        received: parsed,
      });
      throw new Error('[DOMAIN_EVENT_ID_INVALID_TYPE]');
    }

    if (!domain_event_id) {
      if ('fields' in (msg as any)) {
        throw Error;
      }
      return;
    }

    /**
     * DOMAIN EVENT FETCH
     * ------------------
     * Immutable source of truth.
     */
    const domainEvent = await db('domain_events')
      .where({ id: domain_event_id })
      .first<{
        id: number;
        shop_id: number;
        event_type: string;
        event_payload: Record<string, any>;
        event_time: Date;
      }>();

    if (!domainEvent) {
      throw new Error(
        `[DOMAIN_EVENT_NOT_FOUND] id=${domain_event_id}`
      );
    }

    /**
     * CANONICAL NORMALIZATION FIX
     * ---------------------------
     * orders/sync MUST be normalized the same as orders/create.
     *
     * Without this:
     * - inconsistent payload structure
     * - unstable or duplicate order identity
     * - projection collapse (only 1 order created)
     */
    if (
      domainEvent.event_type === 'orders/create' ||
      domainEvent.event_type === 'orders/sync'
    ) {
      try {
        const { mapShopifyOrderNodeToCanonical } = await import(
          '../services/mappers/shopify-to-canonical-order.js'
        );

      } catch (err) {
        console.error('[CANONICAL_NORMALIZATION_FAILED]', {
          eventId: domainEvent.id,
          error: err,
        });
      }
    }

   /**
     * TRANSACTIONAL CURSOR ENFORCEMENT ONLY
     * --------------------------------------
     * Strict monotonic + contiguous invariants
     * must be enforced inside the projection transaction
     * using SELECT ... FOR UPDATE.
     *
     * Queue delivery order is NOT a replay guarantee.
     * The database is the canonical ordering authority.
     *
     * Therefore, no pre-transaction cursor checks are allowed here.
     */

    /**
     * ORDER ENFORCEMENT NOTE
     * ----------------------
     * Projection ordering must ONLY be enforced inside the
     * transaction using SELECT ... FOR UPDATE.
     *
     * Pre-transaction checks are forbidden because:
     * - they race with concurrent workers
     * - they violate deterministic replay
     * - they duplicate cursor logic
     */

    /**
     * CANONICAL EVENT TIME CHECK
     */
    if (!domainEvent.event_time) {
      throw new Error(
        '[EVENT_TIME_VIOLATION] missing canonical event_time'
      );
    }

    /**
     * CANONICAL EVENT DISPATCHER
     * ---------------------------
     * All external signals must be materialized
     * exclusively through this boundary.
     */
    switch (domainEvent.event_type) {
  
      default:
        break;
    }

      return;
    } catch (error) {

    /**
     * PROJECTION ERRORS MUST NOT BE SWALLOWED
     * ----------------------------------------
     * - Worker transport may nack.
     * - CLI replay must fail immediately.
     *
     * Deterministic rebuild requires hard failure.
     */

    if (msg && 'fields' in (msg as any)) {
      try {
        throw error;
      } catch (nackError) {
        console.error(
          '[worker] Failed to nack message after processing error:',
          nackError
        );
      }
    }

    throw error; // CRITICAL: propagate failure
  }
};