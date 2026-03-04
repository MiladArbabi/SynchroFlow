/**
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * CLI must explicitly load .env.
 */
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { reconcileOrderFulfillment } from '../workers/reconciliation/reconciliation.handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../../../../.env'),
});

 /**
  * REBUILD MODE FLAG
  * ------------------
  * Explicitly disables all queue side-effects during replay.
  * Worker must check this flag.
  */
 process.env.REBUILD_MODE = 'true';

import { projectDomainEvent } from '../projection/projection.engine.js';
import db from '@lasyncro/backend-core/db.js';

async function truncateProjections() {
  console.log('[REBUILD] Truncating projection tables...');

  /**
   * REBUILD PURITY RULE
   * -------------------
   * Rebuild must not interact with RabbitMQ.
   * Projection replay is fully DB-driven.
   */
  console.log('[REBUILD] Queue interaction skipped (deterministic mode)');

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
 * DETERMINISTIC RECONCILIATION EXECUTION
 * --------------------------------------
 * During normal runtime reconciliation is executed
 * asynchronously via queue dispatcher.
 *
 * Deterministic rebuild cannot rely on queues.
 *
 * Therefore we must execute reconciliation inline
 * for every captured reconciliation intent.
 *
 * Guarantees:
 * - Revenue units materialized
 * - Inventory projections rebuilt
 * - Operational snapshots computed
 * - Deterministic replay safety preserved
 */
async function executeReconciliationIntents() {

  console.log('[REBUILD] Executing reconciliation intents...');

  const intents = await db('order_reconciliation_intents')
    .orderBy('created_at', 'asc');

  for (const intent of intents) {

    /**
     * OBSERVED PAYLOAD NORMALIZATION
     * ------------------------------
     * The `observed` column is JSONB.
     *
     * During runtime it may arrive either as:
     * - string (older migrations)
     * - object (pg JSONB automatic decoding)
     *
     * Deterministic rebuild must support both
     * without throwing parsing errors.
     */
    let observed;

    if (intent.observed) {
      observed =
        typeof intent.observed === 'string'
          ? JSON.parse(intent.observed)
          : intent.observed;
    }

    await reconcileOrderFulfillment(
      intent.lasyncro_order_id,
      intent.aggregate_version,
      observed
    );
  }

  console.log(
    `[REBUILD] Reconciliation completed for ${intents.length} intents`
  );
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
    /**
     * DETERMINISTIC COLUMN ORDER
     * --------------------------
     * Object.keys() enumeration order is not guaranteed stable
     * across executions.
     * We must sort column names lexicographically before using
     * them for ORDER BY.
     */
    const columns = Object
      .keys(await db(table).columnInfo())
      .sort();

    const rows = await db(table)
      .select('*')
      .orderBy(columns);

    const tableHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rows))
      .digest('hex');

    console.log(`[REBUILD_TABLE_HASH] ${table} ${tableHash}`);

    hash.update(tableHash);
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
  await truncateProjections();
  await replayEvents();

  /**
   * RECONCILIATION PHASE
   * --------------------
   * Required for deterministic rebuild because
   * runtime reconciliation normally occurs via worker.
   */
  await executeReconciliationIntents();

  /**
   * REBUILD PURITY RULE
   * -------------------
   * No queue initialization.
   * No consumer startup.
   * Deterministic replay only.
   */

  const stateHash = await computeStateHash();
  console.log('[REBUILD_STATE_HASH]', stateHash);

  console.log('[REBUILD] Completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[REBUILD] Failed:', err);
  process.exit(1);
});