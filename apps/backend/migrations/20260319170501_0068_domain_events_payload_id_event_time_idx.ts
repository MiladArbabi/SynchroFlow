import { Knex } from 'knex';

/**
 * INDEX: (event_payload->>'id', event_time DESC)
 * ----------------------------------------------
 * Optimizes reconciliation anchor query:
 *
 * WHERE event_payload->>'id' = ?
 * ORDER BY event_time DESC
 * LIMIT 1
 *
 * Ensures:
 * - index lookup on payload id
 * - no sort needed
 * - constant-time retrieval
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE INDEX domain_events_payload_id_event_time_idx
    ON domain_events ((event_payload->>'id'), event_time DESC);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS domain_events_payload_id_event_time_idx;
  `);
}