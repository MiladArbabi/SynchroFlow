//apps/backend/migrations/20251223194501_add_lifecycle_audit_read_index.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('lifecycle_audit_events', (table) => {
    table.index(
      ['user_id', 'occurred_at'],
      'lifecycle_audit_user_occurred_at_idx'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('lifecycle_audit_events', (table) => {
    table.dropIndex(
      ['user_id', 'occurred_at'],
      'lifecycle_audit_user_occurred_at_idx'
    );
  });
}
