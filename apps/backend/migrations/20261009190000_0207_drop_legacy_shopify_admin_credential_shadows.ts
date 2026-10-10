import type { Knex } from 'knex';

/**
 * Shopify Admin credential authority retirement.
 *
 * shopify_admin_credentials is the sole Shopify Admin API credential authority.
 *
 * These columns were transitional compatibility shadows and must no longer
 * physically exist:
 * - shopify_app_installations.access_token
 * - integrations.access_token_encrypted
 *
 * The migration is intentionally irreversible. Recreating empty legacy
 * credential columns would not restore deleted credential material and would
 * reintroduce misleading credential-authority surfaces.
 */
export async function up(knex: Knex): Promise<void> {
  const hasCanonicalTable = await knex.schema.hasTable(
    'shopify_admin_credentials'
  );

  if (!hasCanonicalTable) {
    throw new Error(
      'SHOPIFY_ADMIN_CREDENTIAL_RETIREMENT: canonical shopify_admin_credentials table is required'
    );
  }

  const hasCanonicalAccessToken = await knex.schema.hasColumn(
    'shopify_admin_credentials',
    'access_token_encrypted'
  );

  const hasCanonicalRefreshToken = await knex.schema.hasColumn(
    'shopify_admin_credentials',
    'refresh_token_encrypted'
  );

  if (!hasCanonicalAccessToken || !hasCanonicalRefreshToken) {
    throw new Error(
      'SHOPIFY_ADMIN_CREDENTIAL_RETIREMENT: canonical credential material columns are required'
    );
  }

  const hasInstallationShadow = await knex.schema.hasColumn(
    'shopify_app_installations',
    'access_token'
  );

  if (hasInstallationShadow) {
    await knex.schema.alterTable('shopify_app_installations', (table) => {
      table.dropColumn('access_token');
    });
  }

  const hasIntegrationShadow = await knex.schema.hasColumn(
    'integrations',
    'access_token_encrypted'
  );

  if (hasIntegrationShadow) {
    await knex.schema.alterTable('integrations', (table) => {
      table.dropColumn('access_token_encrypted');
    });
  }
}

export async function down(): Promise<void> {
  throw new Error(
    'Irreversible migration: retired Shopify Admin credential shadows cannot be restored'
  );
}
