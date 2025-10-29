// packages/api/migrations/20251029103752_add_shop_id_to_users_table.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.table('users', (table) => {
    table.integer('shop_id')
         .unsigned()
         .references('id')
         .inTable('shops')
         .onDelete('SET NULL'); // Or 'CASCADE'
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table('users', (table) => {
    table.dropColumn('shop_id');
  });
}