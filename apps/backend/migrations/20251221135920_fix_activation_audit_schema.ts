// apps/backend/migrations/20251221135920_fix_activation_audit_schema.ts
import { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.alterTable('activation_audit_events', (table) => {
    table.string('derivation_version').notNullable();
    table.string('payload_hash').notNullable();

    table.string('entry_channel').notNullable().alter();
  });
}

export async function down(knex: Knex) {
  // irreversible — audit tables must not roll back
}