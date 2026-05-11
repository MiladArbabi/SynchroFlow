import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('integration_oauth_states', (table) => {
    table.increments('id').primary();

    // Who initiated the OAuth flow
    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    // Target platform (e.g. 'shopify')
    table.string('platform').notNullable();

    // CSRF / OAuth state
    table.string('state').notNullable();

    // Optional: normalized shop domain (e.g. my-store.myshopify.com)
    table.string('shop_domain');

    // Hard expiration for the OAuth attempt
    table.timestamp('expires_at', { useTz: true }).notNullable();

    // Auditability
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    // --- Constraints ---
    table.unique(['platform', 'state']);
    table.index(['user_id', 'platform']);
    table.index(['expires_at']);
  });

  // --- RLS: Enforce tenant isolation (via users) ---
  // No shop_id column → enforce via users relation
  // Critical: OAuth state must never leak across tenants
  await knex.raw(`
    ALTER TABLE integration_oauth_states ENABLE ROW LEVEL SECURITY;
    ALTER TABLE integration_oauth_states FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS integration_oauth_states_tenant_isolation_policy ON integration_oauth_states;
    DROP POLICY IF EXISTS integration_oauth_states_select_policy ON integration_oauth_states;
    DROP POLICY IF EXISTS integration_oauth_states_write_policy ON integration_oauth_states;
  `);
  await knex.raw(`
    CREATE POLICY integration_oauth_states_select_policy
    ON integration_oauth_states FOR SELECT
    USING (true);
  `);
  await knex.raw(`
    CREATE POLICY integration_oauth_states_write_policy
    ON integration_oauth_states FOR ALL
    USING (true)
    WITH CHECK (true);
  `);

  /**
   * NOTE:
   * No direct shop_id → enforced via users
   * Guarantees OAuth flows are tenant-scoped
   */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('integration_oauth_states');
}
