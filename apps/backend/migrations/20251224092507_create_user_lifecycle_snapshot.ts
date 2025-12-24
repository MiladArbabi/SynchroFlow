//apps/backend/migrations/20251224092507_create_user_lifecycle_snapshot.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_lifecycle_snapshot', (table) => {
    table.integer('user_id').notNullable().primary();
    table.integer('shop_id').notNullable();

    table.string('phase', 32).notNullable();
    table.timestamp('since', { useTz: true }).notNullable();

    table.uuid('last_event_id').notNullable();

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['phase'], 'user_lifecycle_snapshot_phase_idx');
  });

  await knex.raw(`
    ALTER TABLE user_lifecycle_snapshot
    ADD CONSTRAINT lifecycle_phase_valid
    CHECK (phase IN ('FT_MINUS_ONE', 'FT0', 'FT1', 'FT2'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_lifecycle_snapshot');
}
