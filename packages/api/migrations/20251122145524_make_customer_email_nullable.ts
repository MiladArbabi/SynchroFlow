// packages/api/migrations/20251122145524_make_customer_email_nullable.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('customers', (table) => {
    table.string('email').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('customers', (table) => {
    table.string('email').notNullable().alter();
  });
}