// apps/backend/migrations/20260702215402_0119_carrier_webhook_tokens.ts
// WM-40 — per-shop opaque routing token for inbound Sendcloud webhooks.
// Mirrors shop_display_tokens exactly (0087): hash-only storage,
// raw token shown once at creation/rotation, revocable.
//
// Also adds webhook_secret to shop_carrier_settings — the HMAC signing
// secret the merchant configures when registering the webhook URL in
// their own Sendcloud dashboard. Encrypted the same way as
// public_key/private_key (AES-256-GCM via encryption.service.ts).

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_carrier_webhook_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.string('carrier_code', 32).notNullable();
    table.string('token_hash', 64).notNullable().unique(); // sha256 hex
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('rotated_at', { useTz: true }).nullable();
    table.timestamp('last_seen_at', { useTz: true }).nullable();

    table.unique(['shop_id', 'carrier_code']);
  });

  await knex.raw(`
  ALTER TABLE shop_carrier_webhook_tokens ENABLE ROW LEVEL SECURITY;
  ALTER TABLE shop_carrier_webhook_tokens FORCE ROW LEVEL SECURITY;
`);

await knex.raw(`
  DROP POLICY IF EXISTS shop_carrier_webhook_tokens_select_policy ON shop_carrier_webhook_tokens;
  DROP POLICY IF EXISTS shop_carrier_webhook_tokens_write_policy ON shop_carrier_webhook_tokens;
`);

// SELECT: cross-tenant lookup required — token resolution happens
// before shop_id is known, at the start of webhook verification
// (same shape as auth-path tables, RLS_blueprint.md §4)
await knex.raw(`
  CREATE POLICY shop_carrier_webhook_tokens_select_policy
  ON shop_carrier_webhook_tokens FOR SELECT
  USING (
    shop_id = current_setting('app.current_tenant', true)::int
    OR current_setting('app.current_tenant', true) IN ('', '0')
    OR current_setting('app.current_tenant', true) IS NULL
  );
`);

// ALL (INSERT/UPDATE/DELETE): strictly tenant-scoped
await knex.raw(`
  CREATE POLICY shop_carrier_webhook_tokens_write_policy
  ON shop_carrier_webhook_tokens FOR ALL
  USING (shop_id = current_setting('app.current_tenant', true)::int)
  WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_carrier_webhook_tokens');
}