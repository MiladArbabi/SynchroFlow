import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_ingestion_events', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('module_id').notNullable();   // e.g. 'product'
    table.string('event').notNullable();       // e.g. 'ingested'

    table.timestamp('created_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.index(['shop_id', 'module_id']);
    /**
     * IDEMPOTENCY CONSTRAINT
     * ----------------------
     * Prevent duplicate ingestion signals.
     *
     * Guarantees:
     * - One signal per (shop, module, event)
     */
    table.unique(['shop_id', 'module_id', 'event']);
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  // shop_id is NOT NULL → authoritative tenant anchor
  await knex.raw(`
    ALTER TABLE shop_ingestion_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_ingestion_events FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shop_ingestion_events_tenant_isolation_policy ON shop_ingestion_events;
  `);

  await knex.raw(`
    CREATE POLICY shop_ingestion_events_tenant_isolation_policy
    ON shop_ingestion_events
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  /**
   * NOTE:
   * Direct enforcement via shop_id
   * Prevents cross-tenant ingestion signal leakage
   */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_ingestion_events');
}