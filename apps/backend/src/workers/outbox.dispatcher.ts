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
const RETRY_CEILING = 10;

/**
 * OUTBOX METRICS (Process-Scoped)
 * --------------------------------
 * Basic visibility before Prometheus integration.
 */
let publishedCount = 0;
let failedCount = 0;
let skippedCount = 0;

/**
 * RETRY CEILING
 * -------------
 * Prevents infinite poison retries.
 * Rows exceeding ceiling are marked failed_at.
 */

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

    const pendingCount = await trx('integration_outbox')
      .whereNull('published_at')
      .whereNull('failed_at')
      .count<{ count: string }>('id as count')
      .first();

    const pending = Number(pendingCount?.count ?? 0);

    if (pending > 0) {
      console.info('[outbox][backlog]', { pending });
    }

    /**
     * VERSION-ORDERED DISPATCH
     * -------------------------
     * Guarantees strict per-aggregate causal ordering.
     * Prevents created_at clock skew from reordering events.
     */
    const rows = await trx('integration_outbox as io')
      .whereNull('io.published_at')
      .whereNull('io.failed_at')
      .whereRaw(`
        io.aggregate_version = (
          SELECT MIN(io2.aggregate_version)
          FROM integration_outbox io2
          WHERE
            io2.aggregate_type = io.aggregate_type
            AND io2.aggregate_id = io.aggregate_id
            AND io2.published_at IS NULL
            AND io2.failed_at IS NULL
        )
      `)
      .orderBy([
        { column: 'io.aggregate_type', order: 'asc' },
        { column: 'io.aggregate_id', order: 'asc' },
        { column: 'io.aggregate_version', order: 'asc' },
      ])
      .limit(BATCH_SIZE)
      .forUpdate()
      .skipLocked();

    if (rows.length === 0) return;

    for (const row of rows) {

      try {
        /**
         * BROKER PUBLISH ATTEMPT
         * -----------------------
         * If sendToQueue throws synchronously,
         * we treat as publish failure.
         */
        const ok = channel.sendToQueue(
          QUEUE,
          Buffer.from(JSON.stringify(row.payload)),
          { persistent: true }
        );

        if (!ok) {
          throw new Error('Broker backpressure: sendToQueue returned false');
        }

        /**
         * SUCCESS → mark as published
         */
        await trx('integration_outbox')
          .where({ id: row.id })
          .update({
            published_at: trx.fn.now(),
            last_error: null,
          });

        const latencyMs =
          new Date().getTime() - new Date(row.created_at).getTime();

          /**
           * OUTBOX METRIC — SUCCESS
           * ------------------------
           * Structured log for deterministic publish trace.
           */
          console.info('[outbox][published]', {
            id: row.id,
            aggregateType: row.aggregate_type,
            aggregateId: row.aggregate_id,
            aggregateVersion: row.aggregate_version,
            latencyMs,
          });

      } catch (err: any) {

        /**
         * FAILURE → increment retry + persist error
         * ------------------------------------------
         * Row remains unpublished.
         * Dispatcher will retry on next poll.
         */
        await trx('integration_outbox')
          .where({ id: row.id })
          .update({
            retry_count: trx.raw('retry_count + 1'),
            last_error: String(err?.message ?? err),
            failed_at: trx.raw(
              `CASE 
                WHEN retry_count + 1 >= ? 
                THEN NOW() 
                ELSE failed_at 
              END`,
              [RETRY_CEILING]
            ),
          });

          /**
           * OUTBOX METRIC — RETRY
           * ----------------------
           * Tracks transient broker failures.
           */
          console.warn('[outbox][retry]', {
            id: row.id,
            aggregateType: row.aggregate_type,
            aggregateId: row.aggregate_id,
            aggregateVersion: row.aggregate_version,
            error: String(err?.message ?? err),
          });

        if (row.retry_count + 1 >= RETRY_CEILING) {
          console.error('[outbox][failed_terminal]', {
            id: row.id,
            aggregateType: row.aggregate_type,
            aggregateId: row.aggregate_id,
            aggregateVersion: row.aggregate_version,
          });
        }
      }
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stopOutboxDispatcher() {
  running = false;
}