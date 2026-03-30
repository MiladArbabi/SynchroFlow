import { Knex } from 'knex';

/**
 * SNAPSHOT: order_risk_snapshot
 * --------------------------------
 * Materialized during reconciliation.
 *
 * Guarantees:
 * - One row per order
 * - Replace-on-reconcile
 * - Derived from canonical + obligation state
 * - No runtime mutation
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_risk_snapshot', (table) => {
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

    table.boolean('is_inventory_blocked').notNullable();
    table.boolean('is_customer_blocked').notNullable();
    table.boolean('is_operational_blocked').notNullable();

    table.boolean('is_at_risk').notNullable();

    /**
     * INVENTORY BLOCKED REVENUE (VARIANT-SCOPED)
     * ------------------------------------------
     * Total revenue tied ONLY to constrained variants.
     *
     * Source:
     * - order_constraints.target_id
     * - joined with order_revenue_units
     *
     * REQUIRED:
     * - Enables correct financial impact visibility
     * - Replaces legacy boolean-only interpretation
     */
    table.decimal('inventory_blocked_revenue', 14, 2)
      .notNullable()
      .defaultTo(0);

    /**
     * PREDICTIVE RISK LAYER
     * ---------------------
     * Model-driven probabilistic fields.
     *
     * These are derived during reconciliation.
     */
    table.decimal('fraud_score', 5, 4).nullable();        // 0.0000 – 1.0000
    table.decimal('return_probability', 5, 4).nullable(); // 0.0000 – 1.0000

    /**
     * OPERATIONAL HEALTH SCORE
     * ------------------------
     * Deterministic composite severity score.
     * Range: 0–100 (integer).
     *
     * Computed exclusively during reconciliation.
     * Replace-on-reconcile.
     *
     * Purpose:
     * Enables cross-order prioritization without
     * runtime aggregation.
     */
    table.integer('order_health_score')
      .notNullable()
      .defaultTo(0);
    
    /**
     * HEALTH SCORE COMPONENTS
     * -----------------------
     * Persist the individual components used to compute
     * order_health_score so the scoring model is auditable
     * and explainable for operational debugging.
     *
     * These fields store the contribution of each factor
     * to the final score at reconciliation time.
     */
    table.integer('aging_risk_component').notNullable().defaultTo(0);
    table.integer('sla_risk_component').notNullable().defaultTo(0);
    table.integer('inventory_risk_component').notNullable().defaultTo(0);
    table.integer('customer_risk_component').notNullable().defaultTo(0);
    table.integer('operational_risk_component').notNullable().defaultTo(0);

    table.timestamp('evaluated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  // Snapshot table → high-risk read surface.
  // MUST use direct shop_id enforcement.
  await knex.raw(`
    ALTER TABLE order_risk_snapshot ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_risk_snapshot FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_risk_snapshot_tenant_isolation_policy ON order_risk_snapshot;
  `);

  await knex.raw(`
    CREATE POLICY order_risk_snapshot_tenant_isolation_policy
    ON order_risk_snapshot
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
     * Snapshots must remain valid across aggregate mutations.
     *
     * aggregate_version is stored purely for replay verification
     * and MUST NOT participate in referential integrity.
     *
     * Only the immutable order identity is referenced.
     */
  await knex.raw(`
    ALTER TABLE order_risk_snapshot
    ADD CONSTRAINT order_risk_snapshot_order_fk
    FOREIGN KEY (lasyncro_order_id)
    REFERENCES orders (lasyncro_order_id)
    ON DELETE CASCADE
  `);

  /**
   * PROBABILISTIC INVARIANTS (HARD GUARANTEE)
   * -----------------------------------------
   * Scores must remain bounded within [0,1].
   * Null allowed (model may not run).
   */
  await knex.raw(`
    ALTER TABLE order_risk_snapshot
    ADD CONSTRAINT order_risk_snapshot_fraud_score_valid_range
      CHECK (fraud_score IS NULL OR (fraud_score >= 0 AND fraud_score <= 1)),
    ADD CONSTRAINT order_risk_snapshot_return_probability_valid_range
      CHECK (return_probability IS NULL OR (return_probability >= 0 AND return_probability <= 1)),
    ADD CONSTRAINT order_risk_snapshot_health_score_valid_range
      CHECK (order_health_score >= 0 AND order_health_score <= 100),
    ADD CONSTRAINT order_risk_snapshot_aggregate_version_positive
      CHECK (aggregate_version > 0)
  `);

  await knex.schema.alterTable('order_risk_snapshot', (table) => {
    table.index(['shop_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_risk_snapshot');
}