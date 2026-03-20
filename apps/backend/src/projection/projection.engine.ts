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
 * CURSOR ADVANCEMENT (TRANSACTION-BOUND)
 */
export async function advanceCursor(
  trx: Knex.Transaction,
  projectionName: string,
  domain_event_id: number,
  eventTime: Date
) {
  await trx('projection_cursors')
    .insert({
      projection_name: projectionName,
      last_processed_event_id: domain_event_id,
      updated_at: eventTime,
    })
    .onConflict('projection_name')
    .merge({
      last_processed_event_id: domain_event_id,
      updated_at: eventTime,
    });
}

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
 * CORE PROJECTION FUNCTION
 * (Mechanical relocation from worker.ts)
 */
export async function projectDomainEventFromMessage(
  msg: { content: Buffer } | null
) {
  if (!msg) return;

  const content = msg.content.toString();

  try {
    let parsed: any;

    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('[PROJECTION_INVALID_JSON]', { raw: content });
      throw err;
    }

    const domain_event_id = Number(parsed?.domain_event_id);

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

    if (domainEvent.event_type === 'orders/create') {
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
         * DUPLICATE EVENT
         */
        if (domain_event_id === cursorRow.last_processed_event_id) {
          console.warn('[PROJECTION_DUPLICATE_EVENT_IGNORED]', {
            projection: projectionName,
            event: domain_event_id,
          });
          return;
        }

        /**
         * LATE EVENT DELIVERY
         * -------------------
         * RabbitMQ delivery order is NOT guaranteed to match the
         * canonical ordering of domain_events.
         *
         * If an older event arrives after a newer one has already
         * been projected, it must be ignored rather than treated
         * as a fatal error.
         *
         * The projection state already includes the effects of
         * this event because the cursor has advanced beyond it.
         *
         * Ignoring preserves deterministic rebuild guarantees.
         */
        if (domain_event_id < cursorRow.last_processed_event_id) {

          console.warn('[PROJECTION_LATE_EVENT_IGNORED]', {
            projection: projectionName,
            last_processed_event_id: cursorRow.last_processed_event_id,
            received_event_id: domain_event_id,
          });

          return;
        }
      }

      const handler = projectionRegistry[domainEvent.event_type];

      /**
       * HANDLER EXISTENCE GUARD
       * -----------------------
       * Domain events without projection handlers must never
       * fail silently.
       *
       * Cursor advancement is still allowed to preserve
       * forward compatibility and deterministic rebuilds.
       */
      if (!handler) {
        console.warn('[PROJECTION_HANDLER_MISSING]', {
          event_type: domainEvent.event_type,
          domain_event_id,
        });
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
       * CURSOR ADVANCEMENT
       * ------------------
       * Cursor must advance for every processed event,
       * even if the projection has no handler for it.
       */
      await advanceCursor(
        trx,
        projectionName,
        domain_event_id,
        canonicalEventTime
      );

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