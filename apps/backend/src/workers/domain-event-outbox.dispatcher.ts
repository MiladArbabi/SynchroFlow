import db, { systemQuery } from '@lasyncro/backend-core/db.js';

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 20;

let running = false;
let isLeader = false;

export async function startDomainEventOutboxDispatcher() {
  if (running) return;
  running = true;

  console.log('[domain-event-outbox] Dispatcher started');

  while (running) {

    const lock = await systemQuery(
      db.raw('SELECT pg_try_advisory_lock(987654321) as locked')
    );

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
      await systemQuery(
        db.raw('SELECT * FROM public.dispatch_domain_event_outbox_batch(?)', [
          BATCH_SIZE,
        ])
      );

    } catch (err) {
      console.error('[domain-event-outbox] error:', err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
