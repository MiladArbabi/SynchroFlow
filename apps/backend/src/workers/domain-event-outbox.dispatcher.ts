import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../queue.js';

const QUEUE = 'events';
const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 20;
const RETRY_CEILING = 10;

let running = false;
let isLeader = false;

export async function startDomainEventOutboxDispatcher() {
  if (running) return;
  running = true;

  console.log('[domain-event-outbox] Dispatcher started');

  /**
   * RMQ CHANNEL REMOVED (ARCHITECTURE LOCK)
   * ---------------------------------------
   * This service no longer depends on RabbitMQ.
   * Prevents accidental reintroduction of queue publishing.
   */
  const channel = null as any;

  while (running) {

    const lock = await db.raw('SELECT pg_try_advisory_lock(987654321) as locked');

      if (!lock.rows[0].locked) {

        if (isLeader) {
/*           console.warn('[OUTBOX_DISPATCH_LOST_LEADERSHIP]');
 */          isLeader = false;
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (!isLeader) {
        /* console.log('[OUTBOX_DISPATCH_BECAME_LEADER]'); */
        isLeader = true;
      }

    try {
      await db.transaction(async (trx) => {

        const rows = await trx('domain_event_outbox')
          .whereNull('published_at')
          .orderBy('id', 'asc')
          .limit(BATCH_SIZE)
          .forUpdate();

        /**
         * STRICT ORDERING GUARANTEE (CRITICAL FIX)
         * ----------------------------------------
         * Removed skipLocked to enforce:
         * - no gaps in dispatch
         * - strict sequential publishing
         *
         * Tradeoff:
         * - lower concurrency
         * - but guarantees deterministic projection
         */

        for (const row of rows) {

          console.debug('[OUTBOX_DISPATCH_TRACE]', {
            outbox_id: row.id,
            domain_event_id: row.domain_event_id,
          });

          /**
           * RMQ DISPATCH DISABLED (ARCHITECTURE ALIGNMENT)
           * ----------------------------------------------
           * System uses DB-driven projection as source of truth.
           *
           * Outbox → RabbitMQ dispatch is intentionally disabled to prevent:
           * - dual transport paths
           * - orphaned queues (events)
           * - non-deterministic behavior
           *
           * To re-enable:
           * - restore sendToQueue block
           * - ensure consumer exists for 'events'
           */
          console.debug('[OUTBOX_DISPATCH_SKIPPED_RMQ]', {
            outbox_id: row.id,
            domain_event_id: row.domain_event_id,
          });

          try {

            await trx('domain_event_outbox')
              .where({ id: row.id })
              .update({
                published_at: trx.fn.now(),
                last_error: null,
              });

          } catch (err: any) {

            /**
             * RETRY TRACKING (RESTORED — SAFE)
             * --------------------------------
             * Still FAIL-FAST:
             * - we rethrow → stops batch
             * But we record state for debugging + observability
             */
            await trx('domain_event_outbox')
              .where({ id: row.id })
              .update({
                retry_count: trx.raw('retry_count + 1'),
                last_error: String(err?.message ?? err),
              });

            console.error('[OUTBOX_DISPATCH_FAILED]', {
              outbox_id: row.id,
              domain_event_id: row.domain_event_id,
              error: err?.message ?? err,
            });

            throw err; // CRITICAL: stop batch (preserve ordering)
          }

        }
      });

    } catch (err) {
      console.error('[domain-event-outbox] error:', err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}