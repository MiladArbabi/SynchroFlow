import { Knex } from 'knex';

/**
 * SNAPSHOT: order_margin_snapshot
 * --------------------------------
 * Materialized during reconciliation.
 *
 * Derived from:
 * - order_revenue_units_net (net_revenue)
 * - estimated_unit_cost
 *
 * Replace-on-reconcile.
 * Deterministic.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_margin_snapshot', (table) => {
    table.uuid('lasyncro_order_id')
      .primary()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');
    
    /**
     * PROJECTION VERSION (HARD GUARANTEE)
     * ------------------------------------
     * Records the exact aggregate_version used
     * during reconciliation.
     *
     * Enables deterministic replay validation.
     */
    table.integer('aggregate_version')
      .notNullable()
      .comment('Projection version used to compute this snapshot');

    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.decimal('gross_revenue', 14, 2).notNullable();
    table.decimal('estimated_cost', 14, 2).notNullable();
    table.decimal('gross_margin', 14, 2).notNullable();

    table.decimal('margin_pct', 6, 4).notNullable();

    table.timestamp('evaluated_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * SYSTEM TIMESTAMPS (MANDATORY FOR SNAPSHOT CONSISTENCY)
     * -----------------------------------------------------
     * Required for:
     * - reconciliation overwrite tracking
     * - ON CONFLICT DO UPDATE compatibility
     * - debugging + audit
     */
    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  /**
   * RLS INVARIANT
   * -------------
   * order_margin_snapshot is tenant-scoped financial projection data.
   *
   * Contains:
   * - revenue
   * - cost
   * - margin metrics
   *
   * Cross-tenant exposure = financial data breach.
   *
   * shop_id is authoritative tenant boundary.
   * No relational fallback allowed.
   */
  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE order_margin_snapshot ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_margin_snapshot FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_margin_snapshot_tenant_isolation_policy ON order_margin_snapshot;
  `);

  await knex.raw(`
    CREATE POLICY order_margin_snapshot_tenant_isolation_policy
    ON order_margin_snapshot
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  /**
   * PROJECTION CONSISTENCY ENFORCEMENT
   * -----------------------------------
   * Snapshot must reference exact (id, version)
   * in canonical orders table.
   */

  /**
   * SNAPSHOT ORDER ID FK
   * --------------------
   * Snapshots must survive aggregate_version increments.
   *
   * aggregate_version remains stored for replay validation
   * but is not part of referential integrity.
   */
  await knex.raw(`
    ALTER TABLE order_margin_snapshot
    ADD CONSTRAINT order_margin_snapshot_order_fk
    FOREIGN KEY (lasyncro_order_id)
    REFERENCES orders (lasyncro_order_id)
    ON DELETE CASCADE
  `);

  /**
   * FINANCIAL INVARIANTS (HARD GUARANTEE)
   * -------------------------------------
   * Revenue and cost must never be negative.
   * Margin may be negative — DO NOT constrain.
   */
  await knex.raw(`
    ALTER TABLE order_margin_snapshot
    ADD CONSTRAINT order_margin_snapshot_gross_revenue_non_negative
      CHECK (gross_revenue >= 0),
    ADD CONSTRAINT order_margin_snapshot_estimated_cost_non_negative
      CHECK (estimated_cost >= 0),
    ADD CONSTRAINT order_margin_snapshot_margin_pct_valid_range
      CHECK (margin_pct <= 1),
    ADD CONSTRAINT order_margin_snapshot_aggregate_version_positive
      CHECK (aggregate_version > 0)
  `);

  /**
   * WRITE GUARD TRIGGER
   * --------------------
   * Prevents manual INSERT/UPDATE outside reconciliation.
   */
  await knex.raw(`
    CREATE TRIGGER order_margin_snapshot_guard
    BEFORE INSERT OR UPDATE ON order_margin_snapshot
    FOR EACH ROW
    EXECUTE FUNCTION enforce_reconciliation_guard();
  `);

  /**
   * AUTO-UPDATE TRIGGER
   * -------------------
   * Ensures updated_at reflects reconciliation overwrite.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_order_margin_snapshot_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_set_order_margin_snapshot_updated_at
    BEFORE UPDATE ON order_margin_snapshot
    FOR EACH ROW
    EXECUTE FUNCTION set_order_margin_snapshot_updated_at();
  `);

  await knex.schema.alterTable('order_margin_snapshot', (table) => {
    table.index(['shop_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_margin_snapshot');
}