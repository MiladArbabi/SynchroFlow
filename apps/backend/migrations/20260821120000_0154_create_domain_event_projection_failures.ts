import type { Knex } from 'knex';

/**
 * PROJ-CONTRACT-24 — projection skip register
 * -------------------------------------------
 * Records domain events that rebuild could not project because their payload
 * violates the canonical contract (see CanonicalContractError). Rebuild skips
 * these rather than halting; the runtime worker still fails hard on them, so a
 * malformed producer is never silently tolerated in live ingestion.
 *
 * TRUNCATED AT THE START OF EVERY REBUILD (rebuild-from-events.ts
 * projectionTables): this table describes the CURRENT replay, not history.
 * If skips accumulated across runs the summary count would be meaningless.
 *
 * domain_events itself is never mutated — failure state lives here so the
 * event log stays immutable (INV-LEDGER-BYPASS-16 invariant family).
 *
 * This table is deliberately NOT exempt from the RLS guard, unlike
 * projection_cursors (0061), which is exempt
 * precisely because it holds no shop_id. This one does, so it carries the
 * standard forced tenant policy. Rebuild is unaffected — the CLI connects as
 * sf_user (BYPASSRLS).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('domain_event_projection_failures', (table) => {
    table.bigInteger('domain_event_id').primary();
    table.integer('shop_id').notNullable();
    table.string('event_type').notNullable();
    table.string('error_tag').notNullable();
    table.text('error_message').notNullable();
    table.timestamp('failed_at', { useTz: true }).notNullable();
    table.index(['shop_id']);
  });

  const t = 'domain_event_projection_failures';
  await knex.raw(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS ${t}_tenant_isolation_policy ON ${t};`);
  await knex.raw(`
    CREATE POLICY ${t}_tenant_isolation_policy
    ON ${t}
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('domain_event_projection_failures');
}
