/**
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * CLI must explicitly load .env.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getQueueChannel } from '../queue.js';
import { initQueue } from '../queue.js';

import { startOutboxDispatcher, stopOutboxDispatcher } from '../workers/outbox.dispatcher.js';
import { startReconciliationConsumer } from '../workers/reconciliation/reconciliation.consumer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../../../../.env'),
});

import db from '@lasyncro/backend-core/db.js';
import { projectDomainEvent } from '../worker.js';

async function waitForOutboxDrain() {
  while (true) {
    const row = await db('integration_outbox')
      .whereNull('published_at')
      .count<{ count: string }>('id as count')
      .first();

    const remaining = Number(row?.count ?? 0);

    if (remaining === 0) break;

    await new Promise((r) => setTimeout(r, 500));
  }
}

async function truncateProjections() {
  console.log('[REBUILD] Truncating projection tables...');

  /**
   * PROJECTION QUEUE PURGE
   * -----------------------
   * Deterministic rebuild requires a clean projection queue.
   * Purge must execute only after channel is connected.
   */
  try {
    const channel = getQueueChannel('events');

    await channel.addSetup(async (ch) => {
      await ch.purgeQueue('events');
    });

    console.log('[REBUILD] Projection queue purged.');
  } catch (err) {
    console.error('[REBUILD_QUEUE_PURGE_FAILED]', err);
    throw err;
  }

  /**
   * FULL PROJECTION RESET
   * ----------------------
   * Deterministic rebuild requires ALL projection-derived
   * tables to be cleared.
   *
   * IMPORTANT:
   * - domain_events must NEVER be truncated.
   * - identity/source-of-truth tables must NEVER be truncated.
   */
  await db.raw(`
    TRUNCATE TABLE

      /**
       * OUTBOX MUST BE CLEARED FOR DETERMINISTIC REBUILD
       * -------------------------------------------------
       * integration_outbox is projection-derived.
       * Replaying events will re-emit version-coupled records.
       * Keeping old rows violates unique constraint:
       * (aggregate_type, aggregate_id, aggregate_version)
       */
      integration_outbox,

      orders,
      order_line_items,
      order_revenue_units,
      refund_executions,
      refund_execution_line_items,

      order_fulfillment_status,
      order_fulfillment_history,
      order_constraint_events,
      order_projection_audit_log,
      order_reconciliation_intents,

      order_age_snapshot,
      order_margin_snapshot,
      order_risk_snapshot,
      orders_operational_control_snapshot,
      revenue_projection_daily,
      daily_operational_brief_snapshot,

      inventory_movements

    RESTART IDENTITY CASCADE;
  `);

  /**
   * Reset projection cursors.
   *
   * IMPORTANT:
   * DELETE is forbidden by DB trigger.
   * TRUNCATE is required for deterministic rebuild.
   */
  await db.raw(`
    TRUNCATE TABLE projection_cursors RESTART IDENTITY;
  `);
}

async function replayEvents() {
  console.log('[REBUILD] Replaying domain events...');

  const events = await db('domain_events')
    .orderBy('id', 'asc')
    .select('id');

  for (const event of events) {
    await projectDomainEvent(event.id);
  }
}

async function main() {
  console.log('[REBUILD] Starting full deterministic rebuild...');

  /**
   * QUEUE INITIALIZATION
   * --------------------
   * Required before purgeQueue().
   */
  await initQueue();
  await truncateProjections();
  startReconciliationConsumer();
  startOutboxDispatcher();
  await replayEvents();

  await waitForOutboxDrain();
  stopOutboxDispatcher();

  console.log('[REBUILD] Completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[REBUILD] Failed:', err);
  process.exit(1);
});