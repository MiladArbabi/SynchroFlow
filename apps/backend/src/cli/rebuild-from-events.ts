import dotenv from 'dotenv';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * ENV BOOTSTRAP (must happen before any DB import)
 * -------------------------------------------------
 * Static ESM imports are hoisted and evaluated before
 * the module body runs. Any import that touches
 * database.config.ts will throw if PGUSER/PGDATABASE
 * are not already set.
 *
 * Therefore: dotenv.config() MUST run here, before
 * any dynamic imports below. Do NOT move it down or
 * convert it to a lazy call.
 *
 * Path: 2 levels up from src/cli/ → repo root .env
 */
dotenv.config({
  // 4 levels up: src/cli/ → src/ → apps/backend/ → apps/ → repo root
  path: path.resolve(__dirname, '../../../../.env'),
});

process.env.REBUILD_MODE = 'true';

/**
 * DYNAMIC IMPORTS (DB-dependent modules)
 * ---------------------------------------
 * These must be dynamic to prevent ESM hoisting from
 * executing database.config.ts before dotenv is loaded.
 */
const { runSchemaGuard } = await import('../utils/schemaGuard.js');
const { processDomainEvent } = await import('../events/processDomainEvent.js');
const { default: db } = await import('@lasyncro/backend-core/db.js');

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
   * PROJECTION TABLE REGISTRY
   * -------------------------
   * Only derived projections may be truncated during rebuild.
   *
   * Canonical state tables MUST NEVER appear here because they are
   * deterministically reconstructed via domain event replay.
   *
   * Forbidden examples:
   * - orders
   * - order_line_items
   * - order_revenue_units
   * - inventory_movements
   *
   * If a canonical table is added here, rebuild correctness is broken.
   */
  const projectionTables = [
    'domain_event_outbox',
    'order_fulfillment_status',
    'order_fulfillment_history',
    'order_constraint_events',
    'order_constraints',
    'order_reconciliation_intents',
    'order_age_snapshot',
    'order_margin_snapshot',
    'order_risk_snapshot',
    'revenue_projection_daily',
    'daily_operational_brief_snapshot',
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

      /**
       * REBUILD SAFETY (READ-ONLY)
       * ---------------------------
       * Rebuild MUST NOT mutate domain_events.
       *
       * If fulfillment events are missing,
       * system is invalid and must be fixed at ingestion layer.
       */
      if (event.event_type === 'orders/sync') {
        const payload = event.event_payload as any;

        if (
          payload.fulfillmentStatus ||
          payload.displayFulfillmentStatus
        ) {
          console.warn('[REBUILD_INCOMPLETE_EVENT_STREAM]', {
            shopId: event.shop_id,
            orderId: payload.id,
            reason: 'Missing fulfillment event in domain_events',
          });
        }
      }

      /**
       * CANONICAL EVENT EXECUTION
       * -------------------------
       * Rebuild must use the deterministic processor
       * to guarantee runtime/replay equivalence.
       */
      await processDomainEvent(event.id);
      lastProcessed = event.id;
    }
  }
}

/**
 * RECONCILIATION INTENT EXECUTION REMOVED
 * ---------------------------------------
 * Runtime reconciliation is executed through the
 * reconciliation queue consumer.
 *
 * Deterministic rebuild must execute reconciliation
 * through the canonical event pipeline instead.
 *
 * Since processDomainEvent() is now the canonical
 * event processor, rebuild must not manually
 * iterate reconciliation intents.
 *
 * Any reconciliation work must be triggered by
 * domain events themselves.
 */

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
      .update(
        JSON.stringify(
          table === 'orders'
            ? rows.map((r: any) => {
                const { last_reconciled_at, ...deterministic } = r;

                /**
                 * NON-DETERMINISTIC FIELD EXCLUSION
                 * --------------------------------
                 * last_reconciled_at uses NOW() (runtime clock)
                 * and must NOT affect rebuild determinism.
                 */
                return deterministic;
              })
            : rows
        )
      )
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
   * INTENT REGENERATION REMOVED
   * ---------------------------
   * Reconciliation intents must originate exclusively
   * from projection handlers during domain event processing.
   *
   * Rebuild must NEVER synthesize intents from derived
   * tables (orders), because this breaks event sourcing
   * determinism and can introduce replay divergence.
   *
   * Canonical rule:
   *
   *   domain_event → projection → reconciliation intent
   *
   * NOT:
   *
   *   derived_state → reconciliation intent
   *
   * If intents are missing after replay, the projection
   * pipeline is incomplete and must be fixed upstream.
   */
  console.info('[REBUILD] reconciliation intents derived from projection replay');

  /**
   * OBLIGATION PHASE REMOVED
   * ------------------------
   * Obligation flags are produced by reconciliation.
   * No rebuild-specific recomputation allowed.
   */

  /**
   * SNAPSHOT RECOMPUTATION REMOVED
   * ------------------------------
   * Shop operational snapshots are executed by the
   * reconciliation pipeline after each order event.
   *
   * Rebuild must not introduce an alternative
   * execution model that recomputes snapshots in
   * bulk loops, as this breaks runtime parity.
   *
   * Canonical execution flow:
   *
   *   domain_event
   *        ↓
   *   reconciliation
   *        ↓
   *   computeShopOperationalSnapshot(shop_id)
   *
   * Therefore rebuild must rely entirely on the
   * reconciliation pipeline to trigger snapshots.
   */
  console.info(
    '[REBUILD] shop snapshots derived from reconciliation pipeline'
  );

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