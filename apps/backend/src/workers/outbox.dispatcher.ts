// apps/backend/src/workers/outbox.dispatcher.ts

import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../queue.js';

/**
 * Outbox Dispatcher Worker
 * -------------------------
 * Responsibility:
 * - Read unpublished integration_outbox rows
 * - Publish to message broker
 * - Mark as published atomically
 *
 * Guarantees:
 * - At-least-once delivery
 * - DB is source of truth
 * - Broker publish only after row lock
 */

const QUEUE = 'fulfillment.reconciliation';
const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 10;

let running = false;

export async function startOutboxDispatcher() {
  if (running) return;
  running = true;

  console.log('[outbox] Dispatcher started');

  const channel = getQueueChannel(QUEUE);

  while (running) {
    try {
      await dispatchBatch(channel);
    } catch (err) {
      console.error('[outbox] Dispatch error:', err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function dispatchBatch(channel: ReturnType<typeof getQueueChannel>) {
  await db.transaction(async (trx) => {

    // 1️⃣ Lock unpublished rows
    const rows = await trx('integration_outbox')
      .whereNull('published_at')
      .orderBy('created_at', 'asc')
      .limit(BATCH_SIZE)
      .forUpdate()
      .skipLocked();

    if (rows.length === 0) return;

    for (const row of rows) {

      // 2️⃣ Publish to broker
      channel.sendToQueue(
        QUEUE,
        Buffer.from(JSON.stringify(row.payload)),
        { persistent: true }
      );

      // 3️⃣ Mark as published
      await trx('integration_outbox')
        .where({ id: row.id })
        .update({
          published_at: trx.fn.now(),
        });
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stopOutboxDispatcher() {
  running = false;
}