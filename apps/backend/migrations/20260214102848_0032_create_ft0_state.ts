import { Knex } from 'knex';

/**
 * ============================================================
 * FT0 STATE (SOVEREIGN)
 * ============================================================
 *
 * Represents system-readiness completion per shop.
 *
 * Invariants:
 * - Exactly one row per shop
 * - Idempotent completion
 * - Completion is irreversible
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ft0_state', table => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE')
      .unique();

    table
      .string('status')
      .notNullable(); // e.g. COMPLETED

    table
      .timestamp('completed_at')
      .nullable();

    table
      .jsonb('completion_reason')
      .notNullable()
      .defaultTo('{}');

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ft0_state');
}
