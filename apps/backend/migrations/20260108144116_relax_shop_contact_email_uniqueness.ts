// apps/backend/migrations/20260108144116_relax_shop_contact_email_uniqueness.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shops', (table) => {
    table.dropUnique(['contact_email']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shops', (table) => {
    table.unique(['contact_email']);
  });
}