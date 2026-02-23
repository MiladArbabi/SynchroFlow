// apps/backend/migrations/20260131153238_create_order_revenue_units.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_revenue_units', (table) => {
    table.increments('id').primary();

    // Scope
    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .string('canonical_order_id')
      .notNullable();

    // Revenue identity
    table.string('sku').notNullable();
    table.integer('quantity').notNullable().defaultTo(1);

    table
      .decimal('unit_revenue', 14, 4)
      .notNullable();

    /**
     * Customer Obligation v3 (Line-level)
     * ----------------------------------
     * NULL  → not evaluated
     * false → evaluated, not blocked
     * true  → evaluated, blocked
     */
    table.boolean('has_customer_block').nullable();

    /**
     * Free-text, non-semantic.
     * NEVER interpreted by code.
     */
    table.text('customer_block_reason').nullable();

    table
      .timestamp('customer_block_evaluated_at')
      .nullable();

    table.timestamps(true, true);

    // Guardrails
    table.index(
      ['shop_id', 'canonical_order_id'],
      'idx_revenue_units_order'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_revenue_units');
}
