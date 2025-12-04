// apps/backend/migrations/20251204120000_create_shop_module_entitlements.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shop_module_entitlements');
  if (exists) return;

  await knex.schema.createTable('shop_module_entitlements', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('module_key').notNullable();
    table.string('flag_key').nullable();
    table
      .string('source')
      .notNullable()
      .defaultTo('free_tier_default');

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['shop_id', 'module_key', 'flag_key']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_module_entitlements');
}
