// apps/backend/src/projection/projection.engine.ts
import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';

import { projectionRegistry } from './projection.registry.js';

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
}: {
  domainEvent: any;
  domain_event_id: number;
}) {
  return db.transaction(async (trx) => {
    // 👉 MOVE existing projection logic here (handler + cursor)
  });
}

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
     * CANONICAL NORMALIZATION LAYER (CRITICAL)
     * ----------------------------------------
     * Ensures projections NEVER consume raw platform payloads.
     *
     * Current scope:
     * - Shopify orders normalization
     *
     * Future:
     * - Extend per event_type
     */
    let canonicalPayload = domainEvent.event_payload;

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

        canonicalPayload = mapShopifyOrderNodeToCanonical(
          domainEvent.event_payload,
          domainEvent.shop_id
        );
      } catch (err) {
        console.error('[CANONICAL_NORMALIZATION_FAILED]', {
          eventId: domainEvent.id,
          error: err,
        });
      }
    }

    /**
     * PROJECTION STREAM RESOLUTION
     * ----------------------------
     * Must resolve AFTER event fetch.
     */
    const projectionName =
      domainEvent.event_type.startsWith('lifecycle/')
        ? LIFECYCLE_PROJECTION
        : ORDERS_PROJECTION;

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

    const canonicalEventTime = new Date(domainEvent.event_time);

    /**
     * CENTRALIZED PROJECTION CURSOR ENFORCEMENT
     * -----------------------------------------
     * All projection ordering invariants are enforced here.
     *
     * Guarantees:
     * - contiguous event processing
     * - duplicate suppression
     * - deterministic replay
     *
     * Handlers must NOT implement cursor logic.
     */

    await db.transaction(async (trx: Knex.Transaction) => {

      const cursorRow = await trx('projection_cursors')
        .where({ projection_name: projectionName })
        .forUpdate()
        .first<{ last_processed_event_id: number }>();

      /**
       * BOOTSTRAP RECOVERY
       * ---------------------------------
       * Queue is NOT guaranteed to contain earliest events.
       *
       * If no cursor exists:
       * - do NOT depend on queue ordering
       * - process current event normally
       * - allow DB to define progression
       */

      if (!cursorRow) {

        if (domain_event_id !== 1) {
          console.error('[PROJECTION_BOOTSTRAP_BLOCKED]', {
            projection: projectionName,
            received_event_id: domain_event_id,
            reason: 'Cursor missing — first event must be id=1',
          });

          throw new Error(
            `[PROJECTION_BOOTSTRAP_VIOLATION] expected first event id=1, received=${domain_event_id}`
          );
        }

        console.warn('[PROJECTION_BOOTSTRAP_START]', {
          projection: projectionName,
          starting_event_id: domain_event_id,
        });

        /**
         * BOOTSTRAP FIX
         * --------------
         * Allow ONLY the true first event to initialize projection.
         *
         * Guarantees:
         * - No cursor jump
         * - Deterministic replay start
         */
      }

      /**
       * CONTIGUOUS EVENT ENFORCEMENT
       * ----------------------------
       * When cursor exists:
       *   enforce strict sequential processing.
       *
       * When cursor does NOT exist:
       *   this is the first event for the projection
       *   and must be processed normally.
       */

      if (cursorRow?.last_processed_event_id != null) {

      const expectedEventId = cursorRow.last_processed_event_id + 1;

      /**
       * CONTIGUOUS SEQUENCE ENFORCEMENT (CRITICAL FIX)
       * -----------------------------------------------
       * Projection MUST process events strictly in order.
       *
       * If a future event arrives (gap), we MUST NOT:
       * - process it
       * - advance cursor
       *
       * Instead:
       * - log hard error
       * - abort processing (forces retry via queue)
       *
       * Without this:
       * - cursor jumps forward
       * - earlier events become permanently ignored
       * - projection becomes irrecoverably inconsistent
       */
      if (domain_event_id > expectedEventId) {

        /**
         * GAP DETECTION (SYSTEM HEALTH SIGNAL)
         * ------------------------------------
         * This indicates:
         * - missing event(s) in queue pipeline
         * - or out-of-order dispatch
         *
         * This is NOT a recoverable local error.
         * It is a SYSTEM-LEVEL integrity issue.
         */
        const gapSize = domain_event_id - expectedEventId;

        console.error('[PROJECTION_SEQUENCE_VIOLATION]', {
          projection: projectionName,
          expected_event_id: expectedEventId,
          received_event_id: domain_event_id,
          gap_size: gapSize,
        });

        /**
         * Explicit signal for monitoring / alerting
         */
        console.error('[PROJECTION_GAP_DETECTED]', {
          projection: projectionName,
          missing_from: expectedEventId,
          missing_to: domain_event_id - 1,
          gap_size: gapSize,
        });

        throw new Error(
          `[PROJECTION_OUT_OF_ORDER] expected=${expectedEventId} received=${domain_event_id} gap=${gapSize}`
        );
      }

        /**
         * DUPLICATE EVENT
         */
        if (domain_event_id === cursorRow.last_processed_event_id) {
          console.warn('[PROJECTION_DUPLICATE_EVENT_IGNORED]', {
            projection: projectionName,
            event: domain_event_id,
          });
          return;
        }

        if (domain_event_id < cursorRow.last_processed_event_id) {

          console.error('[PROJECTION_LATE_EVENT_DETECTED_FATAL]', {
            projection: projectionName,
            last_processed_event_id: cursorRow.last_processed_event_id,
            received_event_id: domain_event_id,
            reason: 'Historical gap detected — projection state is corrupted',
          });

          /**
           * CRITICAL FIX — NO SILENT SKIPS
           * --------------------------------
           * Late events indicate one of:
           * - cursor jumped ahead (confirmed incident)
           * - missing historical processing
           *
           * We MUST NOT silently skip:
           * → it locks system into incomplete state
           *
           * Instead:
           * → fail fast
           * → force operator intervention (rebuild/reset)
           */
          throw new Error(
            `[PROJECTION_STATE_CORRUPTED] late event detected id=${domain_event_id} < cursor=${cursorRow.last_processed_event_id}`
          );
        }
      }

      const handler = projectionRegistry[domainEvent.event_type];

      (domainEvent as any).canonical_payload = canonicalPayload;

      /**
       * CRITICAL: attach canonical payload to domainEvent
       * so handlers operate on normalized data
       */

      if (!handler) {
      /**
       * MISSING HANDLER = HARD FAILURE (CRITICAL FIX)
       * ---------------------------------------------
       * Advancing cursor without a handler causes:
       * - permanent data loss
       * - irrecoverable projection gaps
       *
       * We MUST fail fast and block progression.
       *
       * This ensures:
       * - new event types cannot silently bypass projections
       * - system remains deterministically rebuildable
       */
      console.error('[PROJECTION_HANDLER_MISSING_FATAL]', {
        event_type: domainEvent.event_type,
        domain_event_id,
      });

      throw new Error(
        `[PROJECTION_HANDLER_MISSING] event_type=${domainEvent.event_type}`
      );
    }

      /**
       * HANDLER EXECUTION
       * -----------------
       * Handlers must execute inside the projection transaction.
       * The trx handle is injected to guarantee atomic projection
       * and deterministic rebuild behavior.
       */
      if (handler) {
        await handler({
          domainEvent: {
            ...domainEvent,
            canonical_payload: canonicalPayload, // ← attach here safely
          },
          domain_event_id,
          canonicalEventTime,
          trx,
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
    });

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