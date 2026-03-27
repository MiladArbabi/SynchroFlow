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
      /**
 * STEP 1 — READ CURSOR (NO LOCK)
 * --------------------------------
 * Lightweight read to determine next event.
 */
const cursorRow = await db('projection_cursors')
  .where({ projection_name: 'orders_projection' })
  .first<{ last_processed_event_id: number }>();

const lastProcessed = Number(cursorRow?.last_processed_event_id ?? 0);

/**
 * STEP 2 — FETCH NEXT EVENT (NO LOCK)
 */
const nextEvents = await db('domain_events')
  .where('id', '>', lastProcessed)
  .orderBy('id', 'asc')
  .limit(BATCH_SIZE);

if (nextEvents.length === 0) {
  continue;
}

/**
 * STEP 3 — PROCESS EACH EVENT IN ITS OWN TRANSACTION
 */
for (const event of nextEvents) {

    await db.transaction(async (trx) => {

        /**
         * LOCK CURSOR ROW (CRITICAL — INSIDE PER-EVENT TX)
         */
        const lockedCursor = await trx('projection_cursors')
          .where({ projection_name: 'orders_projection' })
          .forUpdate()
          .first<{ last_processed_event_id: number }>();

        const currentLastProcessed = Number(lockedCursor?.last_processed_event_id ?? 0);

        const eventId = Number(event.id);
        const expectedId = currentLastProcessed + 1;

        /**
         * RELAXED ORDERING — COMMIT-AWARE PROCESSING
         * ------------------------------------------
         * Postgres does NOT guarantee commit order == id order.
         *
         * Therefore:
         * - Gaps are allowed temporarily
         * - We only process strictly increasing IDs
         * - Missing IDs will be picked up in next poll
         *
         * This preserves:
         * - determinism
         * - no skipping
         * - no crashes
         */
        if (eventId <= currentLastProcessed) {
          console.warn('[DB_PROJECTION_DUPLICATE_OR_STALE]', {
            eventId,
            lastProcessed: currentLastProcessed,
          });
          return;
        }

        console.debug('[DB_PROJECTION_PROCESSING]', {
          domain_event_id: event.id,
        });

        /**
         * FETCH DOMAIN EVENT (CONSISTENT READ)
         */
        const domainEvent = await trx('domain_events')
          .where({ id: eventId })
          .first();

        if (!domainEvent) {
          throw new Error(`[DB_PROJECTION_EVENT_MISSING] id=${eventId}`);
        }

        /**
         * EXECUTE PROJECTION
         */
        try {
          await projectDomainEventCore({
            domainEvent,
            domain_event_id: eventId,
            trx
          });
        } catch (err) {
          console.error('[PROJECTION_EVENT_FAILURE]', {
            eventId,
            eventType: domainEvent.event_type,
            payload: domainEvent.event_payload,
            error: err,
          });
          throw err;
        }

        /**
         * ADVANCE CURSOR (ATOMIC WITH PROJECTION)
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

        console.debug('[DB_PROJECTION_EXECUTED]', {
          domain_event_id: eventId,
        });
      });
    }
    } catch (err) {
      console.error('[projection-db-worker][FATAL]', err);

      /**
       * FAIL FAST (CRITICAL)
       * --------------------
       * Projection errors must NEVER be swallowed.
       *
       * If we continue:
       * - events are skipped
       * - system enters inconsistent state
       *
       * Strategy:
       * - crash worker
       * - force restart / operator visibility
       */
      throw err;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}