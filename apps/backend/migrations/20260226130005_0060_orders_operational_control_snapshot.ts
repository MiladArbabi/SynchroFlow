import { Knex } from 'knex';

/**
 * SNAPSHOT: orders_operational_control_snapshot
 * --------------------------------------------
 * Phase 1 Control Tower — Unified Operational Surface
 *
 * Characteristics:
 * - One row per (shop_id, snapshot_date)
 * - Replace-on-reconcile only
 * - Fully derived
 * - No runtime aggregation
 * - Authoritative source for Control Tower
 *
 * This table intentionally aggregates:
 * - Revenue Integrity
 * - Order Health
 * - Constraint Intelligence
 * - Operational Work Queues
 *
 * NOTE:
 * Per-order snapshots remain separate.
 * This is shop-level compression for execution surface.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable(
    'orders_operational_control_snapshot',
    (table) => {
      table.integer('shop_id')
        .notNullable()
        .references('id')
        .inTable('shops')
        .onDelete('CASCADE');

      table.date('snapshot_date').notNullable();

      /**
       * PROJECTION VERSION (HARD GUARANTEE)
       * ------------------------------------
       * Records the aggregate_version of the triggering
       * reconciliation event.
       *
       * Enables replay determinism validation for
       * shop-level compression snapshot.
       */
      table.integer('aggregate_version')
        .notNullable()
        .comment('Projection version used to compute this control snapshot');

      /**
       * ─────────────────────────────────────────
       * REVENUE INTEGRITY
       * ─────────────────────────────────────────
       */
      table.decimal('realized_revenue', 14, 2)
        .notNullable()
        .defaultTo(0);

      table.decimal('at_risk_revenue', 14, 2)
        .notNullable()
        .defaultTo(0);

      table.decimal('blocked_revenue', 14, 2)
        .notNullable()
        .defaultTo(0);
      
      /**
       * Pending Revenue
       * ---------------
       * Revenue tied to orders that are not yet fulfilled.
       *
       * Definition:
       * SUM(net_revenue) WHERE fulfillment_status != 'fulfilled'
       *
       * Computed inside reconciliation projection and
       * persisted here to prevent resolver-side recomputation.
       *
       * Guarantees:
       * - deterministic rebuilds
       * - strict projection authority
       * - UI passthrough safety
       */
      table.decimal('pending_revenue', 14, 2)
        .notNullable()
        .defaultTo(0);

      table.decimal('revenue_leakage', 14, 2)
        .notNullable()
        .defaultTo(0);

      table.decimal('avg_contribution_margin_pct', 6, 4)
        .notNullable()
        .defaultTo(0);

      /**
       * ─────────────────────────────────────────
       * ORDER HEALTH
       * ─────────────────────────────────────────
       */
      table.integer('orders_at_sla_risk')
        .notNullable()
        .defaultTo(0);

      table.integer('aging_24h')
        .notNullable()
        .defaultTo(0);

      table.integer('aging_48h')
        .notNullable()
        .defaultTo(0);

      table.integer('aging_72h_plus')
        .notNullable()
        .defaultTo(0);

      table.integer('pending_fulfillment')
        .notNullable()
        .defaultTo(0);

      table.integer('pending_payment')
        .notNullable()
        .defaultTo(0);

      table.integer('exception_orders')
        .notNullable()
        .defaultTo(0);

      /**
       * ─────────────────────────────────────────
       * CONSTRAINT INTELLIGENCE
       * ─────────────────────────────────────────
       */
      table.integer('constrained_orders')
        .notNullable()
        .defaultTo(0);

      table.decimal('revenue_blocked_inventory', 14, 2)
        .notNullable()
        .defaultTo(0);

      table.decimal('revenue_blocked_customer', 14, 2)
        .notNullable()
        .defaultTo(0);

      table.decimal('revenue_blocked_operational', 14, 2)
        .notNullable()
        .defaultTo(0);

      /**
       * ─────────────────────────────────────────
       * WORK QUEUES
       * ─────────────────────────────────────────
       */
      table.integer('queue_manual_review')
        .notNullable()
        .defaultTo(0);

      table.integer('queue_awaiting_inventory')
        .notNullable()
        .defaultTo(0);

      table.integer('queue_ready_to_ship')
        .notNullable()
        .defaultTo(0);

      table.integer('queue_awaiting_customer')
        .notNullable()
        .defaultTo(0);

      /**
       * PARTIAL FULFILLMENT OPPORTUNITY
       * --------------------------------
       * Orders containing both:
       * - available inventory
       * - out-of-stock items
       *
       * Enables warehouse to ship available items
       * while backordering remaining SKUs.
       *
       * Computed deterministically by reconciliation worker.
       */
      table.integer('partial_fulfillment_opportunity')
        .notNullable()
        .defaultTo(0);

      table.timestamp('evaluated_at')
        .notNullable()
        .defaultTo(knex.fn.now());

      table.primary(['shop_id', 'snapshot_date']);
    }
  );

  /**
   * FINANCIAL INVARIANTS (HARD GUARANTEE)
   * -------------------------------------
   * Aggregated revenue fields must never be negative.
   * Leakage remains constrained >= 0 by definition.
   */
  await knex.raw(`
    ALTER TABLE orders_operational_control_snapshot
    ADD CONSTRAINT oocs_realized_revenue_non_negative
      CHECK (realized_revenue >= 0),
    ADD CONSTRAINT oocs_at_risk_revenue_non_negative
      CHECK (at_risk_revenue >= 0),
    ADD CONSTRAINT oocs_blocked_revenue_non_negative
      CHECK (blocked_revenue >= 0),
    ADD CONSTRAINT oocs_pending_revenue_non_negative
      CHECK (pending_revenue >= 0),
    ADD CONSTRAINT oocs_revenue_leakage_non_negative
      CHECK (revenue_leakage >= 0),
    ADD CONSTRAINT oocs_inventory_blocked_revenue_non_negative
      CHECK (revenue_blocked_inventory >= 0),
    ADD CONSTRAINT oocs_customer_blocked_revenue_non_negative
      CHECK (revenue_blocked_customer >= 0),
    ADD CONSTRAINT oocs_operational_blocked_revenue_non_negative
      CHECK (revenue_blocked_operational >= 0),
    ADD CONSTRAINT oocs_aggregate_version_positive
      CHECK (aggregate_version > 0)
  `);

  await knex.schema.alterTable(
    'orders_operational_control_snapshot',
    (table) => {
      table.index(['shop_id'], 'oocs_shop_idx');
    }
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(
    'orders_operational_control_snapshot'
  );
}