import { Knex } from 'knex';

/**
 * UNIFIED ORDER CONSTRAINT MODEL
 * ------------------------------
 * Introduces normalized constraint storage.
 *
 * Replaces fragmented *_block_type columns with:
 * - type-safe constraint records
 * - per-constraint lifecycle tracking
 *
 * IMPORTANT:
 * - Non-breaking: existing columns remain during transition
 * - Enables gradual migration of projections + dispatcher
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_constraints', (table) => {

    table.uuid('constraint_id').primary();

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    /**
     * TARGET SCOPE
     * ------------
     * Optional entity this constraint applies to.
     * Example: variant_id for inventory constraints.
     *
     * REQUIRED to prevent order-level false positives.
     */
    table.uuid('target_id').nullable();

    /**
     * Constraint category
     * -------------------
     * inventory | customer | operational
     */
    table.text('constraint_type').notNullable();

    /**
     * Block subtype
     * -------------
     * e.g. oversell, awaiting_payment, sla_breach
     */
    table.text('block_type').nullable();

    /**
     * Lifecycle tracking (per constraint)
     */
    table.timestamp('started_at', { useTz: true }).nullable();
    table.timestamp('resolved_at', { useTz: true }).nullable();

    table.boolean('is_active').notNullable().defaultTo(true);

    /**
     * WRITE ORIGIN TRACE
     * -------------------
     * Identifies which projection/service wrote the constraint.
     *
     * REQUIRED for:
     * - multi-writer detection
     * - debugging race conditions
     * - auditability of constraint lifecycle
     */
    table.text('write_source').nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
    table.index(['constraint_type']);
    table.index(['is_active']);
  });

  // --- RLS: relational tenant isolation via orders ---
  await knex.raw(`
    ALTER TABLE order_constraints ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY order_constraints_tenant_isolation
    ON order_constraints
    USING (
      EXISTS (
        SELECT 1 FROM orders
        WHERE orders.lasyncro_order_id = order_constraints.lasyncro_order_id
        AND orders.shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

/**
 * SCOPE-AWARE UNIQUENESS
 * ----------------------
 * Allows multiple constraints per order per type
 * as long as they apply to different targets.
 */
  await knex.raw(`
    CREATE UNIQUE INDEX uniq_active_constraint_per_scope
    ON order_constraints (lasyncro_order_id, constraint_type, target_id)
    WHERE is_active = true;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS order_constraints_tenant_isolation ON order_constraints;
  `);
  
  await knex.schema.dropTableIfExists('order_constraints');
}