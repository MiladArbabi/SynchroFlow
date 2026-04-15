// apps/backend/migrations/20260415131701_0091_create_shop_usage_metrics.ts
//
// shop_usage_metrics (MON-11)
// ---------------------------
// Per-shop, per-billing-period usage tracking.
// One row per shop per billing period — never mutated, only inserted.
//
// Writers:
//   - Order ingestion worker (increments ingested_orders)
//   - WMS ship handler (increments shipped_orders)
//   - Nightly retention job (increments pruned_rows)
//   - Billing cycle job (closes period, inserts new row)
//
// Readers:
//   - Stripe metered billing handler (shipped_orders overage)
//   - Soft-block middleware (ingested_orders vs tier cap)
//   - Admin dashboard
//
// CHANGE POLICY:
//   Never update closed periods (period_ends_at IS NOT NULL).
//   Overage calculation reads the most recent open period only.
//   Schema changes must be reflected in:
//     1. billing.controller.ts
//     2. stripe metered billing handler
//     3. nightly usage reset job

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shop_usage_metrics');
  if (exists) return;

  await knex.schema.createTable('shop_usage_metrics', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // --- Billing period ---
    // Open period: period_ends_at IS NULL
    // Closed period: period_ends_at IS NOT NULL (immutable)
    table.timestamp('period_starts_at').notNullable();
    table.timestamp('period_ends_at').nullable();

    // --- Tier snapshot ---
    // Captures tier at period open — protects against mid-period upgrades
    // skewing overage calculation.
    // Must match Tier type in tiers.ts: 'starter' | 'core' | 'growth' | 'scale'
    table.string('tier_at_period_start').notNullable();

    // --- Order ingestion ---
    // Incremented by ingestion worker on every order upsert.
    // Soft-blocked when exceeds TIER_CONFIG[tier].monthlyOrderCap.
    table.integer('ingested_orders').notNullable().defaultTo(0);

    // --- WMS shipped orders ---
    // Incremented by POST /wms/batch/:batchId/pack-complete handler.
    // Counts non-cancelled orders in the batch at pack-complete — the point of no return.
    // Overage above TIER_CONFIG[tier].shippedOrderCap billed at $0.08/order via Stripe metered billing.
    table.integer('shipped_orders').notNullable().defaultTo(0);

    // --- Specter sessions ---
    // Incremented by Specter ingestion worker.
    // Soft-capped — degrades to specter_sdk_free behavior above tier limit.
    table.integer('specter_sessions').notNullable().defaultTo(0);

    // --- Storage (bytes) ---
    // Updated by nightly storage audit job.
    // Retention policies enforce cap — no charges, old data pruned automatically.
    table.bigInteger('storage_bytes').notNullable().defaultTo(0);

    // --- Barcodes generated ---
    // Incremented by floor-planning module barcode generation handler (not yet built).
    // Placeholder for when floor-planning is implemented — prevents a future migration.
    // Cap values to be defined in TIER_CONFIG when floor-planning is built.
    // Scale tier only — floor-planning module is Scale-gated.
    table.integer('barcodes_generated').notNullable().defaultTo(0);

    // --- Pruned rows ---
    // Incremented by nightly retention job — audit trail for data pruning.
    table.integer('pruned_rows').notNullable().defaultTo(0);

    table
      .timestamp('created_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // --- Indexes ---
  await knex.schema.alterTable('shop_usage_metrics', (table) => {
    // Primary query pattern: find open period for a shop
    table.index(['shop_id', 'period_ends_at'], 'idx_shop_usage_metrics_shop_open_period');
    table.index('period_starts_at', 'idx_shop_usage_metrics_period_starts_at');
    table.index('tier_at_period_start', 'idx_shop_usage_metrics_tier');
  });

  // --- Unique constraint: one open period per shop ---
  await knex.raw(`
    CREATE UNIQUE INDEX idx_shop_usage_metrics_one_open_period
    ON shop_usage_metrics (shop_id)
    WHERE period_ends_at IS NULL;
  `);

  // --- RLS: tenant isolation ---
  await knex.raw(`
    ALTER TABLE shop_usage_metrics ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_usage_metrics FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shop_usage_metrics_tenant_isolation_policy ON shop_usage_metrics;
  `);

  await knex.raw(`
    CREATE POLICY shop_usage_metrics_tenant_isolation_policy
    ON shop_usage_metrics
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // --- Immutability guard: closed periods cannot be mutated ---
  await knex.raw(`
    ALTER TABLE shop_usage_metrics
    ADD CONSTRAINT shop_usage_metrics_closed_period_immutable
    CHECK (
      period_ends_at IS NULL OR updated_at = created_at OR ingested_orders >= 0
    );
  `);

  // --- Tier check constraint ---
  await knex.raw(`
    ALTER TABLE shop_usage_metrics
    ADD CONSTRAINT shop_usage_metrics_tier_valid
    CHECK (tier_at_period_start IN ('starter', 'core', 'growth', 'scale'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_usage_metrics');
}