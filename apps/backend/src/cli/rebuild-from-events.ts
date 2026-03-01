/**
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * CLI must explicitly load .env.
 */
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

import { fileURLToPath } from 'url';
import { getQueueChannel } from '../queue.js';
import { initQueue } from '../queue.js';

import { startReconciliationConsumer } from '../workers/reconciliation/reconciliation.consumer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../../../../.env'),
});

import { projectDomainEvent } from '../worker.js';
import db from '@lasyncro/backend-core/db.js';

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
       */
      domain_event_outbox,

      /**
       * ORDERS PROJECTION TABLES
       */
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

      inventory_movements,

      /**
       * LIFECYCLE PROJECTION TABLES
       * ----------------------------
       * REQUIRED for deterministic rebuild.
       * These tables are projection-derived and must NOT survive replay.
       */
      user_lifecycle_snapshot,
      lifecycle_audit_events,
      lifecycle_events,

      ft0_state,
      ft2_state,
      system_readiness_state,
      expansion_eligibility_state

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

/**
 * DETERMINISTIC STATE HASH
 * ------------------------
 * Produces canonical SHA256 hash of projection state.
 * Used for replay validation.
 */
async function computeStateHash(): Promise<string> {
  const tables = [
    'orders',
    'order_line_items',
    'order_revenue_units',
    'order_age_snapshot',
    'order_margin_snapshot',
    'order_risk_snapshot',
    'orders_operational_control_snapshot',
    'projection_cursors',
  ];

  const hash = crypto.createHash('sha256');

  for (const table of tables) {
    const rows = await db(table)
      .select('*')
      .orderByRaw('1'); // deterministic ordering

    hash.update(JSON.stringify(rows));
  }

  return hash.digest('hex');
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
  await replayEvents();

  const stateHash = await computeStateHash();
  console.log('[REBUILD_STATE_HASH]', stateHash);

  console.log('[REBUILD] Completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[REBUILD] Failed:', err);
  process.exit(1);
});