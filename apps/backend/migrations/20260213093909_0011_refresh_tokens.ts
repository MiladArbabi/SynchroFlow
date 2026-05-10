// apps/backend/migrations/20260213093909_0011_refresh_tokens.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('refresh_tokens', (table) => {
    table.increments('id').primary();

    // ───────────────────────────────────────────
    // Identity anchors
    // ───────────────────────────────────────────

    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table
      .integer('shop_id')
      .nullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.uuid('session_id').notNullable();

    table.integer('token_version').notNullable().defaultTo(1);

    // ───────────────────────────────────────────
    // Security
    // ───────────────────────────────────────────

    table.string('token_hash', 255).notNullable();

    table.timestamp('expires_at', { useTz: true }).notNullable();

    table.timestamp('revoked_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // ───────────────────────────────────────────
    // Indexes
    // ───────────────────────────────────────────

    table.index(['user_id'], 'refresh_tokens_user_id_idx');
    table.index(['shop_id'], 'refresh_tokens_shop_id_idx');
    table.index(['session_id'], 'refresh_tokens_session_id_idx');
    table.index(['token_hash'], 'refresh_tokens_token_hash_idx');
    table.index(
      ['user_id', 'session_id'],
      'refresh_tokens_user_session_idx'
    );
  });

  // --- TENANT INVARIANT ENFORCEMENT ---
  // refresh tokens must always belong to a tenant
  await knex.raw(`
    ALTER TABLE refresh_tokens
    ALTER COLUMN shop_id SET NOT NULL;
  `);

  // --- RLS: Enforce tenant isolation (via users) ---
  await knex.raw(`
    ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
    ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS refresh_tokens_tenant_isolation_policy ON refresh_tokens;
    DROP POLICY IF EXISTS refresh_tokens_select_policy ON refresh_tokens;
    DROP POLICY IF EXISTS refresh_tokens_write_policy ON refresh_tokens;
  `);

  /* -- 🔒 Direct tenant enforcement (authoritative)
  -- shop_id is NOT NULL → must be used as primary isolation boundary */
  await knex.raw(`
    CREATE POLICY refresh_tokens_select_policy
    ON refresh_tokens FOR SELECT
    USING (
      shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IN ('', '0')
      OR current_setting('app.current_tenant', true) IS NULL
    );
  `);
  await knex.raw(`
    CREATE POLICY refresh_tokens_write_policy
    ON refresh_tokens FOR ALL
    USING (shop_id = current_setting('app.current_tenant', true)::int)
    WITH CHECK (true);
  `);

  // NOTE:
  // shop_id is enforced NOT NULL → authoritative tenant anchor
  // Direct RLS avoids unnecessary joins and eliminates ambiguity
  // Ensures strict, consistent tenant isolation at DB level
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
}