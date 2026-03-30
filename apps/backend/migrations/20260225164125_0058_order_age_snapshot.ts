import type { Knex } from "knex";

/**
 * ORDER AGE SNAPSHOT
 * ==================
 *
 * Derived operational read model.
 *
 * Purpose:
 * - Materialize order aging classification
 * - Enable SLA breach detection
 * - Enable latency monitoring
 *
 * Characteristics:
 * - Replace-on-reconcile
 * - No incremental mutation
 * - Fully derived from canonical order + fulfillment state
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_age_snapshot', (table) => {

    table
      .uuid('lasyncro_order_id')
      .primary()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    /**
     * PROJECTION VERSION (HARD GUARANTEE)
     * ------------------------------------
     * Snapshot must record the exact aggregate_version
     * used during reconciliation.
     *
     * Enables replay determinism validation.
     */
    table.integer('aggregate_version')
      .notNullable()
      .comment('Projection version used to compute this snapshot');

    /**
     * AGE INVARIANT (HARD GUARANTEE)
     * ------------------------------
     * Ages must NEVER be negative.
     * Negative age indicates event-time ordering violation.
     * Enforced at both code and DB level.
     */
    table.integer('age_since_creation_seconds').notNullable()
    table.integer('age_since_paid_seconds').nullable()
    table.integer('age_since_fulfillment_seconds').nullable()

    /**
     * SLA breach flags
     */
    table.boolean('is_shipping_sla_breached')
      .notNullable()
      .defaultTo(false);

    table.boolean('is_delivery_sla_breached')
      .notNullable()
      .defaultTo(false);

    /**
     * Snapshot timestamp
     */
    table.timestamp('snapshot_generated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    
    /**
     * AGE INVARIANT (>= 0)
     * --------------------
     * Zero is valid.
     * Negative indicates event-time violation.
     */
    table.check('age_since_creation_seconds >= 0', [], 'age_since_creation_seconds_non_negative');
    table.check('age_since_paid_seconds IS NULL OR age_since_paid_seconds >= 0', [], 'age_since_paid_seconds_non_negative');
    table.check('age_since_fulfillment_seconds IS NULL OR age_since_fulfillment_seconds >= 0', [], 'age_since_fulfillment_seconds_non_negative');

    table.index(['is_shipping_sla_breached']);

    /**
     * PROJECTION VERSION INVARIANT
     * ----------------------------
     * aggregate_version must always be positive.
     * Zero indicates projection corruption.
     */
    table.check(
      'aggregate_version > 0',
      [],
      'order_age_snapshot_aggregate_version_positive'
    );

    table.index(['is_delivery_sla_breached']);
  });

  /**
   * RLS INVARIANT
   * -------------
   * order_age_snapshot is tenant-scoped operational timing data.
   *
   * Contains:
   * - order age
   * - delay exposure
   * - SLA pressure indicators
   *
   * Cross-tenant access reveals:
   * - fulfillment speed
   * - backlog severity
   * - operational inefficiencies
   *
   * Tenant isolation is enforced via orders relation.
   * order_age_snapshot does NOT store shop_id directly.
   *
   * This ensures:
   * - no duplication of tenant key
   * - strict alignment with canonical order ownership
   *
   * DO NOT introduce shop_id here without full migration rewrite.
   */
  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE order_age_snapshot ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_age_snapshot FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_age_snapshot_tenant_isolation_policy ON order_age_snapshot;
  `);

  await knex.raw(`
    CREATE POLICY order_age_snapshot_tenant_isolation_policy
    ON order_age_snapshot
    USING (
      lasyncro_order_id IN (
        SELECT o.lasyncro_order_id
        FROM orders o
        WHERE o.shop_id = current_setting('app.current_tenant')::int
      )
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
   * Snapshot validity must not depend on mutable aggregate_version.
   *
   * Version column retained for deterministic rebuild validation only.
   */
  await knex.raw(`
    ALTER TABLE order_age_snapshot
    ADD CONSTRAINT order_age_snapshot_order_fk
    FOREIGN KEY (lasyncro_order_id)
    REFERENCES orders (lasyncro_order_id)
    ON DELETE CASCADE
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_age_snapshot');
}