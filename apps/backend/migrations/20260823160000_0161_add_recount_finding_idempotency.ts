import type { Knex } from 'knex';

/**
 * MIGRATION 0161 — recount finding idempotency (RECOUNT-EXCEPTIONS-80)
 *
 * A finding dialog submission owns one client-generated UUID. Retries of the
 * same submission reuse that UUID, while a genuinely new observation receives
 * a new UUID.
 *
 * Existing findings predate this contract, so client_event_id remains nullable.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('inventory_recount_findings');
  if (!exists) {
    throw new Error(
      '[0161] inventory_recount_findings must exist before adding idempotency'
    );
  }

  const hasClientEventId = await knex.schema.hasColumn(
    'inventory_recount_findings',
    'client_event_id'
  );

  if (!hasClientEventId) {
    await knex.schema.alterTable('inventory_recount_findings', (table) => {
      table.uuid('client_event_id').nullable();
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      inventory_recount_findings_shop_client_event_unique
    ON inventory_recount_findings (shop_id, client_event_id)
    WHERE client_event_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('inventory_recount_findings');
  if (!exists) return;

  await knex.raw(`
    DROP INDEX IF EXISTS
      inventory_recount_findings_shop_client_event_unique
  `);

  const hasClientEventId = await knex.schema.hasColumn(
    'inventory_recount_findings',
    'client_event_id'
  );

  if (hasClientEventId) {
    await knex.schema.alterTable('inventory_recount_findings', (table) => {
      table.dropColumn('client_event_id');
    });
  }
}
