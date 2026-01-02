// apps/backend/migrations/20260102154905_create_ft2_state.ts
import type { Knex } from 'knex';

/**
 * FT2 State (Capability Latch)
 * ----------------------------
 * Authoritative, irreversible record that a shop has graduated to FT2.
 *
 * HARD GUARANTEES:
 * - One row per shop (primary key)
 * - Written once, never updated
 * - Read by lifecycle resolver, never inferred
 * - Snapshot-based and auditable
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ft2_state', (table) => {
    // Canonical shop identifier
    table.integer('shop_id').notNullable().primary();

    // Exact moment FT2 was latched
    table.timestamp('completed_at', { useTz: true }).notNullable();

    // Evaluator version used to grant FT2
    table.text('evaluator_version').notNullable();

    // Frozen evaluator output (full snapshot)
    table.jsonb('evaluation_snapshot').notNullable();

    // Optional: protect against accidental duplicate rows
    table.unique(['shop_id'], 'uq_ft2_state_shop_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ft2_state');
}
