import db from '@lasyncro/backend-core/db.js';
import { projectDomainEventCore } from '../projection/projection.engine.js';
import { debugLog } from '../projection/projection.utils.js';

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
const MAX_TRANSIENT_GAP_RETRIES = 50; // ~10 seconds at 200ms poll interval
let transientGapRetries = 0;

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
 * CURSOR INVARIANT GUARD (CRITICAL)
 * ---------------------------------
 * Ensures projection cursor never exceeds available domain events.
 *
 * Prevents:
 * - phantom progress
 * - skipped projections
 * - unrecoverable state divergence
 *
 * Invariant:
 *   cursor <= MAX(domain_events.id)
 */
const maxEventRow = await db('domain_events')
  .max<{ max: number }>('id as max')
  .first();

const maxEventId = Number(maxEventRow?.max ?? 0);

if (lastProcessed > maxEventId) {
  console.error('[PROJECTION_CURSOR_CORRUPTION_FATAL]', {
    lastProcessed,
    maxEventId
  });

  throw new Error(
    `[PROJECTION_CURSOR_INVALID] cursor=${lastProcessed} max_event_id=${maxEventId}`
  );
}

/**
 * STEP 2 — FETCH NEXT EVENT (NO LOCK)
 */
const nextEvents = await db('domain_events')
  .where('id', '>', lastProcessed)
  .orderBy('id', 'asc')
  .limit(BATCH_SIZE);

if (nextEvents.length === 0) {
  /**
   * IDLE BACKOFF (CRITICAL)
   * -----------------------
   * `continue` skips the sleep at the bottom of the loop,
   * causing a tight busy-loop against the DB when the queue is empty.
   * Always wait POLL_INTERVAL_MS before re-polling.
   */
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  continue;
}

/**
 * STEP 3 — PROCESS EACH EVENT IN ITS OWN TRANSACTION
 */
for (const event of nextEvents) {

    await db.transaction(async (trx) => {

        /**
         * TENANT INSERTION (CRITICAL)
         */
        await trx.raw(`SET LOCAL app.current_tenant = '${event.shop_id}'`);

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
         * DUPLICATE / STALE GUARD
         * -----------------------
         * Event already processed — skip silently.
         */
        if (eventId <= currentLastProcessed) {
          console.warn('[DB_PROJECTION_DUPLICATE_OR_STALE]', {
            eventId,
            lastProcessed: currentLastProcessed,
          });
          return;
        }

        /**
         * GAP DETECTION (CRITICAL)
         * ------------------------
         * expectedId = currentLastProcessed + 1
         *
         * gap == 1 (eventId === expectedId): normal — process.
         *
         * gap == 1 but eventId > expectedId by exactly 1:
         *   Postgres non-sequential commit artifact — the missing
         *   event is in-flight. Return without advancing cursor;
         *   it will be picked up on next poll.
         *
         * gap > 1 (eventId > expectedId + 1):
         *   Genuine missing events — IDs were skipped or deleted.
         *   Continuing would permanently skip those events.
         *   HALT: operator must investigate and reset cursor.
         *
         * To recover from HALT:
         *   UPDATE projection_cursors
         *   SET last_processed_event_id = <last_known_good_id>
         *   WHERE projection_name = 'orders_projection';
         */
        const gapSize = eventId - expectedId;

        if (gapSize === 0) {
          // Normal case — fall through to processing
        } else if (gapSize === 1) {
          /**
           * TRANSIENT GAP ESCALATION (CRITICAL)
           * -------------------------------------
           * Single-ID gaps are expected from Postgres commit ordering.
           * However if the gap persists beyond MAX_TRANSIENT_GAP_RETRIES,
           * the missing event is permanently absent — not in-flight.
           *
           * Escalate to FATAL to prevent indefinite pipeline stall.
           * Operator must investigate event ID and reset cursor if needed.
           */
          transientGapRetries++;

          console.warn('[DB_PROJECTION_GAP_TRANSIENT]', {
            eventId,
            expectedId,
            attempt: transientGapRetries,
            maxAttempts: MAX_TRANSIENT_GAP_RETRIES,
            action: 'wait_and_retry',
          });

          if (transientGapRetries >= MAX_TRANSIENT_GAP_RETRIES) {
            /**
             * SEQUENCE GAP SKIP (CRITICAL)
             * ----------------------------
             * After MAX_TRANSIENT_GAP_RETRIES, the missing ID is
             * permanently absent — caused by a rolled-back transaction
             * that consumed a sequence value without committing.
             *
             * Postgres SERIAL sequences do not roll back — gaps are
             * permanent and unrecoverable. Halting here would stall
             * the pipeline forever on every upstream rollback.
             *
             * Strategy: advance cursor to currentLastProcessed so the
             * next poll picks up eventId (the next visible event).
             * Log at ERROR for full operator visibility.
             */
            console.error('[DB_PROJECTION_GAP_SKIPPED]', {
              skippedEventId: expectedId,
              nextEventId: eventId,
              attempts: transientGapRetries,
              reason: 'Postgres sequence gap — transaction rolled back',
              action: 'advancing cursor past gap',
            });

            await trx('projection_cursors')
              .where({ projection_name: 'orders_projection' })
              .update({
                last_processed_event_id: expectedId, // skip the missing sequence gap
                updated_at: trx.fn.now(),
              });

            transientGapRetries = 0;
            return;
          }
          return;

        } else {
          /**
           * MULTI-ID GAP — genuine missing events.
           * Halting to prevent silent permanent skip.
           */
          console.error('[DB_PROJECTION_GAP_FATAL]', {
            eventId,
            expectedId,
            missingIds: `${expectedId}..${eventId - 1}`,
            missingCount: gapSize,
            action: 'HALTED — operator intervention required',
            recovery: `UPDATE projection_cursors SET last_processed_event_id = ${currentLastProcessed} WHERE projection_name = 'orders_projection'`,
          });
          throw new Error(
            `[PROJECTION_GAP_FATAL] missing events ${expectedId}..${eventId - 1} (count=${gapSize})`
          );
        }

        debugLog('[DB_PROJECTION_PROCESSING]', {
          domain_event_id: event.id,
        });

        transientGapRetries = 0; // reset on successful event acquisition

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

        debugLog('[DB_CURSOR_ADVANCED]', {
          to: eventId,
        });

        debugLog('[DB_PROJECTION_EXECUTED]', {
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