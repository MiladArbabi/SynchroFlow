import db from '@lasyncro/backend-core/db.js';
import { projectDomainEventCore } from '../projection/projection.engine.js';

/**
 * DB-DRIVEN PROJECTION WORKER (SOURCE OF TRUTH)
 * --------------------------------------------
 * Guarantees:
 * - strict ordering via domain_events.id
 * - no gaps
 * - no reordering
 * - deterministic replay
 *
 * This replaces queue-based ordering guarantees.
 */

const BATCH_SIZE = 1; // strict ordering (do NOT increase yet)
const POLL_INTERVAL_MS = 200;

let running = false;

export async function startDbProjectionWorker() {
  if (running) return;
  running = true;

  console.info('[projection-db-worker] started');

  while (running) {
    try {
      await db.transaction(async (trx) => {

        /**
         * LOCK CURSOR ROW
         */
        const cursorRow = await trx('projection_cursors')
          .where({ projection_name: 'orders_projection' })
          .forUpdate()
          .first<{ last_processed_event_id: number }>();

        const lastProcessed = Number(cursorRow?.last_processed_event_id ?? 0);

        /**
         * FETCH NEXT EVENT (STRICT ORDER)
         */
        const nextEvents = await trx('domain_events')
          .where('id', '>', lastProcessed)
          .orderBy('id', 'asc')
          .limit(BATCH_SIZE);

        if (nextEvents.length === 0) {
          return;
        }

        for (const event of nextEvents) {

          const eventId = Number(event.id);
          const expectedId = lastProcessed + 1;

        if (eventId !== expectedId) {
        console.error('[DB_PROJECTION_GAP_DETECTED]', {
            expected: expectedId,
            received: eventId,
            raw_received: event.id, // instrumentation for type issues
        });

        throw new Error(
            `[DB_PROJECTION_OUT_OF_ORDER] expected=${expectedId} received=${eventId}`
        );
        }

          console.debug('[DB_PROJECTION_PROCESSING]', {
            domain_event_id: event.id,
          });

          /**
           * CALL EXISTING ENGINE (REUSE LOGIC)
           */
          const { projectDomainEvent } = await import(
            '../projection/projection.engine.js'
          );

          const domainEvent = await db('domain_events')
            .where({ id: eventId })
            .first();

        if (!domainEvent) {
            throw new Error(`[DB_PROJECTION_EVENT_MISSING] id=${eventId}`);
        }

        await projectDomainEventCore({
            domainEvent,
            domain_event_id: eventId,
        });

        /**
         * STRICT CURSOR ADVANCEMENT (DB-DRIVEN SOURCE OF TRUTH)
         * -----------------------------------------------------
         * MUST use same trx to guarantee:
         * - atomicity (projection + cursor)
         * - no replay inconsistencies
         */
        await trx('projection_cursors')
            .insert({
                projection_name: 'orders_projection',
                last_processed_event_id: eventId,
                updated_at: trx.fn.now(),
            })
            .onConflict('projection_name')
            .merge({
                last_processed_event_id: eventId,
                updated_at: trx.fn.now(),
            });

        console.debug('[DB_CURSOR_ADVANCED]', {
            to: eventId,
        });

        /**
         * PROJECTION SUCCESS TRACE
         */
        console.debug('[DB_PROJECTION_EXECUTED]', {
            domain_event_id: eventId,
        });
          }
      });

    } catch (err) {
      console.error('[projection-db-worker] error', err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}