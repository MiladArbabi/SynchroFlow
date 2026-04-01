import { Knex } from 'knex';

/**
 * EVENT LOG: order_constraint_events
 * -----------------------------------
 * Append-only constraint lifecycle events.
 *
 * Derived from obligation evaluation.
 *
 * Supports:
 * - Root cause grouping
 * - Constraint duration analysis
 * - Risk trend modeling
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_constraint_events', (table) => {
    table.uuid('constraint_event_id')
      .primary();

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.enu('constraint_type', [
      'inventory',
      'customer',
      'operational'
    ]).notNullable();

    /**
     * VARIANT-SCOPED SUPPORT (CRITICAL)
     * ---------------------------------
     * Required for:
     * - inventory constraints (variant-level)
     * - consistency with order_constraints
     *
     * Without this:
     * - constraint loss
     * - dual-write failure
     */
    table.string('target_id').nullable();

    table.timestamp('started_at').notNullable();

    /**
     * EVALUATION TIMESTAMP (CRITICAL)
     * -------------------------------
     * Represents when constraint was evaluated in reconciliation.
     *
     * Required for:
     * - risk projection alignment
     * - deterministic replay
     * - dual-write compatibility
     */
    table.timestamp('evaluated_at').notNullable();

    table.timestamp('resolved_at').nullable();

    table.boolean('is_active').notNullable();

    /**
     * RECONCILIATION VERSION TRACKING
     * -------------------------------
     * Required for:
     * - deterministic replay
     * - idempotency alignment with projections
     */
    table.integer('aggregate_version').notNullable();

    table.timestamp('created_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * UPSERT SUPPORT
     * --------------
     * Required for ON CONFLICT DO UPDATE
     */
    table.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
      });

  /**
   * RLS INVARIANT
   * -------------
   * order_constraint_events represents tenant-scoped operational control signals.
   *
   * Contains:
   * - constraint violations
   * - enforcement triggers
   * - operational decision inputs
   *
   * Cross-tenant visibility exposes:
   * - internal failures
   * - operational weaknesses
   * - system behavior signals
   *
   * shop_id is authoritative tenant boundary.
   * No relational enforcement allowed.
   */
  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE order_constraint_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_constraint_events FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_constraint_events_tenant_isolation_policy ON order_constraint_events;
  `);

  await knex.raw(`
    CREATE POLICY order_constraint_events_tenant_isolation_policy
    ON order_constraint_events
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  await knex.schema.alterTable('order_constraint_events', (table) => {
    table.index(['shop_id', 'constraint_type'], 'oce_shop_type_idx');
    table.index(['target_id'], 'oce_target_idx');
    table.index(['lasyncro_order_id', 'is_active'], 'oce_order_active_idx');
  });

  /**
   * Active constraint uniqueness
   * ----------------------------
   * Prevents duplicate active constraints
   * for the same order and constraint type.
   *
   * Uses partial index to allow historical
   * resolved rows to remain in the table.
   */
  await knex.raw(`
    CREATE UNIQUE INDEX oce_unique_active_constraint
    ON order_constraint_events (lasyncro_order_id, constraint_type, target_id)
    WHERE is_active = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_constraint_events');
}