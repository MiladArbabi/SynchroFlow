import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('integrations', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('platform').notNullable();
    table.string('platform_shop_name');

    table.text('access_token_encrypted').notNullable();

    table.timestamps(true, true);

    /**
     * Integration identity invariant:
     * One integration per (shop_id, platform).
     * Required for OAuth upsert via:
     *   ON CONFLICT (shop_id, platform)
     */
    table.unique(['shop_id', 'platform'], {
      indexName: 'integrations_shop_platform_unique',
    });

    // Optional email for sync completion notification (set via "Email me" CTA in FT0)
    table.string('sync_notify_email').nullable();
  });

  // --- RLS: Enforce tenant isolation ---
  // CRITICAL: integrations contain external access tokens
  await knex.raw(`
    ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS integrations_tenant_isolation_policy ON integrations;
  `);

  await knex.raw(`
    CREATE POLICY integrations_tenant_isolation_policy
    ON integrations
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('integrations');
}
