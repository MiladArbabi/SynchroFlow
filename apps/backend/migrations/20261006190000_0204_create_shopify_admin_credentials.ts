import type { Knex } from 'knex';

/**
 * SHOP-REVIEW-AUTH-01 — credential persistence expansion only.
 * Legacy tokens remain compatibility fields until consumers are cut over.
 * No credential backfill or provider calls occur here.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shopify_app_installations', (table) => {
    table.unique(['id', 'shop_id'], 'shopify_app_installations_id_shop_id_unique');
  });

  await knex.schema.createTable('shopify_admin_credentials', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('installation_id').notNullable().unique();
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');
    table
      .foreign(['installation_id', 'shop_id'], 'shopify_admin_credentials_installation_shop_fk')
      .references(['id', 'shop_id'])
      .inTable('shopify_app_installations')
      .onDelete('CASCADE');

    // Acquisition/coordination may precede a usable token pair.
    table.text('access_token_encrypted').nullable();
    table.text('refresh_token_encrypted').nullable();
    table.timestamp('access_expires_at', { useTz: true }).nullable();
    table.timestamp('refresh_expires_at', { useTz: true }).nullable();
    table.text('granted_scopes').nullable();
    table.bigInteger('credential_generation').notNullable().defaultTo(0);
    table.text('credential_state').nullable();
    table.uuid('rotation_lease_token').nullable();
    table.timestamp('rotation_lease_expires_at', { useTz: true }).nullable();
    table.timestamp('rotation_started_at', { useTz: true }).nullable();
    table.timestamps(true, true);
    table.index(['shop_id']);
  });

  const tenantExpression = `
    shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;

  await knex.raw(`
    ALTER TABLE shopify_admin_credentials
      ADD CONSTRAINT shopify_admin_credentials_generation_nonnegative
      CHECK (credential_generation >= 0);

    ALTER TABLE shopify_admin_credentials ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopify_admin_credentials FORCE ROW LEVEL SECURITY;

    CREATE POLICY shopify_admin_credentials_select_policy
      ON shopify_admin_credentials FOR SELECT
      USING (${tenantExpression});

    CREATE POLICY shopify_admin_credentials_write_policy
      ON shopify_admin_credentials FOR ALL
      USING (${tenantExpression})
      WITH CHECK (${tenantExpression});

    GRANT SELECT, INSERT, UPDATE ON shopify_admin_credentials TO sf_app;
    REVOKE DELETE ON shopify_admin_credentials FROM sf_app;

    ALTER TABLE integrations ALTER COLUMN access_token_encrypted DROP NOT NULL;
    ALTER TABLE shopify_app_installations ALTER COLUMN access_token DROP NOT NULL;
  `);
}

export async function down(_knex: Knex): Promise<void> {
  // Preserve credentials and expansion-period rows; never restore NOT NULL blindly.
  throw new Error(
    'SECURITY_MIGRATION_IRREVERSIBLE: Shopify credential authority and nullable legacy tokens must be preserved'
  );
}
