// apps/backend/migrations/20251221125323_add_entry_channel_to_users.ts
import { Knex } from 'knex';
export async function up(knex: Knex) {
  await knex.schema.alterTable('users', (table) => {
    table.string('entry_channel').defaultTo('unknown');
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('entry_channel');
  });
}
