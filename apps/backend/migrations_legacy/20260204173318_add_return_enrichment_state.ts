import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Create enum explicitly (idempotent)
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'return_enrichment_status'
      ) THEN
        CREATE TYPE return_enrichment_status AS ENUM (
          'pending',
          'retrying',
          'enriched',
          'failed'
        );
      END IF;
    END
    $$;
  `);

  // 2. Use enum WITHOUT letting Knex manage it
  await knex.schema.alterTable('canonical_returns', (t) => {
    t
      .specificType('enrichment_status', 'return_enrichment_status')
      .notNullable()
      .defaultTo('pending');

    t.integer('enrichment_attempts').notNullable().defaultTo(0);
    t.timestamp('next_enrichment_at', { useTz: true }).nullable();
    t.text('last_enrichment_error').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_returns', (t) => {
    t.dropColumn('enrichment_status');
    t.dropColumn('enrichment_attempts');
    t.dropColumn('next_enrichment_at');
    t.dropColumn('last_enrichment_error');
  });

  // DO NOT drop enum — shared / reused
}