//apps/backend/migrations/20251221132735_add_activation_audit_columns.ts
import { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.alterTable('activation_audit_events', (table) => {
    table.string('derivation_version').notNullable();
    table.string('entry_channel').notNullable();
    table.string('payload_hash').notNullable();
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('activation_audit_events', (table) => {
    table.dropColumn('derivation_version');
    table.dropColumn('entry_channel');
    table.dropColumn('payload_hash');
  });
}
