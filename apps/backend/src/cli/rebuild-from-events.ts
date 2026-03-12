/**
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * CLI must explicitly load .env.
 */
import dotenv from 'dotenv';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

    import fs from 'fs';
    import path from 'path';

import { runSchemaGuard } from '../utils/schemaGuard.js';
import { reconcileOrderFulfillment } from '../workers/reconciliation/reconciliation.handlers.js';
import { computeShopOperationalSnapshot } from '../workers/projections/shopOperationalSnapshot.worker.js';

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
import knex from 'knex';

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
   * SAFE PROJECTION TRUNCATION
   * ---------------------------
   * PostgreSQL does not support TRUNCATE ... IF EXISTS.
   *
   * Therefore we dynamically truncate only tables that
   * currently exist in the schema.
   *
   * Guarantees:
   * - rebuild never fails during migration development
   * - deterministic rebuild preserved
   */

  /**
   * LEGACY TABLE
   * -------------
   * lifecycle_audit_events kept only for historical rebuilds.
   * No new writes should occur after migration to lifecycle_events.
   */

  const projectionTables = [
    'domain_event_outbox',
    'orders',
    'order_line_items',
    'order_revenue_units',
    'refund_executions',
    'refund_execution_line_items',
    'order_fulfillment_status',
    'order_fulfillment_history',
    'order_constraint_events',
    'order_projection_audit_log',
    'order_reconciliation_intents',
    'order_age_snapshot',
    'order_margin_snapshot',
    'order_risk_snapshot',
    'orders_operational_control_snapshot',
    'revenue_projection_daily',
    'daily_operational_brief_snapshot',
    'inventory_movements',
    'user_lifecycle_snapshot',
    'lifecycle_audit_events',
    'lifecycle_events',
    'ft0_state',
    'ft2_state',
    'system_readiness_state',
    'expansion_eligibility_state'
  ];

  for (const table of projectionTables) {
    const exists = await db
      .select('tablename')
      .from('pg_tables')
      .where({
        schemaname: 'public',
        tablename: table
      })
      .first();

    if (exists) {
      await db.raw(
        `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`
      );
    }
  }

  /**
   * SAFE CURSOR RESET
   * -----------------
   * projection_cursors may not exist during early
   * migration development.
   *
   * Rebuild must never fail due to schema evolution.
   */

  const cursorTableExists = await db
    .select('tablename')
    .from('pg_tables')
    .where({
      schemaname: 'public',
      tablename: 'projection_cursors'
    })
    .first();

  if (cursorTableExists) {
    await db.raw(
      `TRUNCATE TABLE "projection_cursors" RESTART IDENTITY`
    );
  }
}

async function replayEvents() {
  console.log('[REBUILD] Replaying domain events...');

  let lastProcessed = 0;

  while (true) {

    const events = await db('domain_events')
      .where('id', '>', lastProcessed)
      .orderBy('id', 'asc')
      .select('id')
      .limit(500);

    if (events.length === 0) break;

    for (const event of events) {
      await projectDomainEvent(event.id);
      lastProcessed = event.id;
    }
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
     * DETERMINISTIC ROW ORDER
     * -----------------------
     * Hash ordering must use primary key columns only.
     * Ordering by all columns is unsafe because equal
     * column values allow PostgreSQL to return rows in
     * arbitrary physical order.
     */

    const pkRows = await db.raw(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = ?
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `, [table]);

    const pkColumns = pkRows.rows.map((r: any) => r.column_name);

    const rows = await db(table)
      .select('*')
      .orderBy(pkColumns);

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
   * EVENT STORE INTEGRITY CHECK
   * ---------------------------
   * Rebuild requires the canonical domain event log.
   *
   * If the table does not exist, migrations were not applied
   * or the wrong database is connected.
   */

  const eventStoreExists = await db
    .select('tablename')
    .from('pg_tables')
    .where({
      schemaname: 'public',
      tablename: 'domain_events'
    })
    .first();

  if (!eventStoreExists) {
    throw new Error(
      '[REBUILD_FATAL] domain_events table missing. Run migrations or verify DB connection.'
    );
  };

  console.log('[REBUILD] Verifying projection schema...');
  await runSchemaGuard();
  console.log('[REBUILD] Schema verification passed');
  
  /**
   * QUEUE INITIALIZATION
   * --------------------
   * Required before purgeQueue().
   */
  await truncateProjections();
  await replayEvents();

  /**
   * REBUILD INTENT REGENERATION
   * ---------------------------
   * Projection replay creates orders but reconciliation
   * normally depends on runtime intent generation.
   *
   * During deterministic rebuild the intent table was
   * truncated earlier, so we regenerate intents directly
   * from the orders table.
   *
   * Guarantees:
   * - reconciliation runs for every order
   * - deterministic rebuild reproducibility
   * - projection handlers remain side-effect free
   */
  console.log('[REBUILD] Regenerating reconciliation intents...');

  await db.raw(`
    INSERT INTO order_reconciliation_intents (
      lasyncro_order_id,
      aggregate_version,
      created_at
    )
    SELECT
      lasyncro_order_id,
      aggregate_version,
      order_created_at
    FROM orders
    ON CONFLICT (lasyncro_order_id, aggregate_version) DO NOTHING
  `);

  /**
   * RECONCILIATION PHASE
   * --------------------
   * Required for deterministic rebuild because
   * runtime reconciliation normally occurs via worker.
   */
  await executeReconciliationIntents();

  /**
   * REBUILD SNAPSHOT RECONSTRUCTION
   * --------------------------------
   * Runtime system computes shop operational snapshots
   * inside the reconciliation worker.
   *
   * Rebuild bypasses the queue layer, therefore snapshots
   * must be recomputed explicitly here.
   *
   * Guarantees:
   * - deterministic reconstruction of operational control state
   * - parity with runtime worker pipeline
   */
  console.log('[REBUILD] Recomputing shop operational snapshots...');

  const shops = await db('orders')
    .distinct('shop_id');

  for (const row of shops) {
    await computeShopOperationalSnapshot(row.shop_id);
  }

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