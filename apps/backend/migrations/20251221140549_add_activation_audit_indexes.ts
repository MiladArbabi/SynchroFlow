// apps/backend/migrations/20251221140549_add_activation_audit_indexes.ts
import { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.alterTable('activation_audit_events', (table) => {
    table.index(['shop_id', 'occurred_at'], 'idx_activation_audit_shop_time');
    table.index(['verdict'], 'idx_activation_audit_verdict');
    table.index(['derivation_version'], 'idx_activation_audit_derivation');
    table.unique(['payload_hash'], 'uq_activation_audit_payload_hash');
  });
}

// irreversible — audit integrity must not be weakened
export async function down() {}
