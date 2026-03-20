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

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
    table.index(['constraint_type']);
    table.index(['is_active']);
  });

    /**
     * PARTIAL UNIQUE INDEX (POSTGRES)
     * ------------------------------
     * Must be created AFTER table exists.
     */
  await knex.raw(`
    CREATE UNIQUE INDEX uniq_active_constraint_per_type
    ON order_constraints (lasyncro_order_id, constraint_type)
    WHERE is_active = true;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_constraints');
}