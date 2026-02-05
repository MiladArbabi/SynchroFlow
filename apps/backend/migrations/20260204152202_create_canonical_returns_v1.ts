// apps/backend/migrations/20260204152202_create_canonical_returns_v1.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('canonical_returns', (table) => {
    table.increments('id').primary();

    // Canonical identity
    table.string('canonical_return_id').notNullable().unique();
    table
      .string('canonical_order_id')
      .notNullable()
      .references('canonical_order_id')
      .inTable('canonical_orders')
      .onDelete('CASCADE');

    table.integer('shop_id').notNullable();

    // Execution timing
    table.timestamp('return_initiated_at').notNullable();

    // Execution state (v1 minimal)
    table
      .enu('return_status', ['initiated', 'received', 'closed'], {
        useNative: true,
        enumName: 'canonical_return_status',
      })
      .notNullable()
      .defaultTo('initiated');

    table
      .enu('execution_source', ['observed', 'synthetic'], {
        useNative: true,
        enumName: 'canonical_return_execution_source',
      })
      .notNullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // Guards
    table.index(['shop_id', 'return_initiated_at'], 'idx_canonical_returns_shop_time');
    table.index(['canonical_order_id'], 'idx_canonical_returns_order');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('canonical_returns');
  await knex.raw('DROP TYPE IF EXISTS canonical_return_status');
  await knex.raw('DROP TYPE IF EXISTS canonical_return_execution_source');
}