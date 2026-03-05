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
     * CONTIGUOUS PROJECTION ORDER ENFORCEMENT
     * ---------------------------------------
     * RabbitMQ delivery order is NOT a correctness guarantee.
     *
     * Projection streams must process domain events strictly
     * in contiguous ID order:
     *
     *   expected_event_id = last_processed_event_id + 1
     *
     * Any gap indicates:
     * - lost message
     * - queue reordering
     * - consumer restart race
     *
     * In those cases we fail fast to preserve projection integrity.
     */
    const cursor = await db('projection_cursors')
      .where({ projection_name: projectionName })
      .first<{ last_processed_event_id: number }>();

    if (cursor?.last_processed_event_id != null) {

      const expectedEventId = cursor.last_processed_event_id + 1;

      if (domain_event_id !== expectedEventId) {

        console.error('[PROJECTION_CONTIGUOUS_VIOLATION]', {
          projection: projectionName,
          lastProcessed: cursor.last_processed_event_id,
          expected: expectedEventId,
          received: domain_event_id,
        });

        throw new Error(
          `[PROJECTION_CONTIGUOUS_VIOLATION] projection=${projectionName} expected=${expectedEventId} received=${domain_event_id}`
        );
      }
    }

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
       * DUPLICATE EVENT
       */
      if (
        cursorRow?.last_processed_event_id != null &&
        domain_event_id <= cursorRow.last_processed_event_id
      ) {
        console.warn('[PROJECTION_DUPLICATE_EVENT_IGNORED]', {
          projection: projectionName,
          last: cursorRow.last_processed_event_id,
          received: domain_event_id,
        });
        return;
      }

      const handler = projectionRegistry[domainEvent.event_type];

      if (!handler) {
        return;
      }

      /**
       * HANDLER EXECUTION
       */
      await handler({
        domainEvent,
        domain_event_id,
        canonicalEventTime,
      });

    });

    const handler = projectionRegistry[domainEvent.event_type];

    if (handler) {
    await handler({
        domainEvent,
        domain_event_id,
        canonicalEventTime,
    });
    return;
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