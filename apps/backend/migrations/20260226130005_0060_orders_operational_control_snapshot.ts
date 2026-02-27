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

      table.timestamp('evaluated_at')
        .notNullable()
        .defaultTo(knex.fn.now());

      table.primary(['shop_id', 'snapshot_date']);
    }
  );

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