import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {

  await knex.schema.createTable('integration_outbox', (table) => {

    table.uuid('id').primary();

    table
      .text('aggregate_type')
      .notNullable();

    table
      .uuid('aggregate_id')
      .notNullable();

    table
      .text('event_type')
      .notNullable();

    /**
     * AGGREGATE VERSION (Ordering Anchor)
     * ------------------------------------
     * Captures version at mutation time.
     * Enables strict per-aggregate publish ordering.
     */
    table
      .integer('aggregate_version')
      .notNullable();

    table
      .jsonb('payload')
      .notNullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('published_at', { useTz: true })
      .nullable();

    table
      .integer('retry_count')
      .notNullable()
      .defaultTo(0);

    table
      .text('last_error')
      .nullable();

    /**
     * TERMINAL FAILURE MARKER
     * ------------------------
     * Set when retry_count exceeds ceiling.
     * Failed rows are excluded from dispatcher scans.
     */
    table
      .timestamp('failed_at', { useTz: true })
      .nullable();

    /**
     * Dispatcher scan index
     * ----------------------
     * Only unpublished and non-failed rows are scanned.
     */
    table.index(
      ['published_at', 'failed_at', 'created_at'],
      'integration_outbox_pending_idx'
    );
  });

  await knex.raw(`
    CREATE UNIQUE INDEX integration_outbox_dedup_idx
    ON integration_outbox (
      aggregate_type,
      aggregate_id,
      aggregate_version
    )
    WHERE published_at IS NULL AND failed_at IS NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('integration_outbox');
}