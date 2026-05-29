// apps/backend/migrations/20260108144712_create_shop_memberships_table.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_memberships', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    /**
     * ROLE
     * ----
     * Enum-constrained at DB level.
     * owner    — full access, settings, batch release
     * admin    — same as owner, multi-user management
     * operator — WMS-only (pick, pack, stow)
     *
     * Source of truth for JWT shop_roles claim (see token.service.ts).
     * users.role mirrors this — kept in sync on role change (WM-31).
     * Will be superseded by action-level entitlements (WM-19).
     */
    table.enum('role', ['owner', 'admin', 'operator']).notNullable();

    table.timestamps(true, true);

    /**
     * CURRENCY LAYER 2 — User Display Preference
     * -------------------------------------------
     * Per-user display currency override.
     * Defaults to shop base_currency at membership creation.
     * All DB values remain in shop base_currency — conversion is display-only.
     *
     * locale: drives Intl.NumberFormat formatting (e.g. 'en-US', 'en-GB')
     * display_currency: ISO 4217 code (e.g. 'USD', 'EUR', 'GBP')
     */
    table.string('display_currency', 3)
      .notNullable()
      .defaultTo('USD');
    table.string('locale', 10)
      .notNullable()
      .defaultTo('en-US');

    /**
     * WMS ANALYTICS — OPERATOR COST & DISPLAY
     * ----------------------------------------
     * hourly_cost: Zone 5 cost-per-order. Owner/admin write-only. Never exposed to operator.
     * display_hidden: excludes operator from Floor Display aggregations (PIP/sensitive cases).
     * owner_notes: management notes. Owner/admin visible only. Soft markdown supported.
     */
    table.decimal('hourly_cost', 10, 2).nullable();
    table.boolean('display_hidden').notNullable().defaultTo(false);
    table.text('owner_notes').nullable();

    table.unique(['shop_id', 'user_id']);
    table.index(['user_id']);
    table.index(['shop_id']);
  });

  // --- RLS: Enforce tenant isolation (direct) ---
// shop_id is NOT NULL → authoritative tenant anchor
await knex.raw(`
  ALTER TABLE shop_memberships ENABLE ROW LEVEL SECURITY;
  ALTER TABLE shop_memberships FORCE ROW LEVEL SECURITY;
`);

await knex.raw(`
  DROP POLICY IF EXISTS shop_memberships_tenant_isolation_policy ON shop_memberships;
  DROP POLICY IF EXISTS shop_memberships_select_policy ON shop_memberships;
  DROP POLICY IF EXISTS shop_memberships_write_policy ON shop_memberships;
`);

await knex.raw(`
  CREATE POLICY shop_memberships_select_policy
  ON shop_memberships FOR SELECT
  USING (
    shop_id = current_setting('app.current_tenant', true)::int
    OR current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR current_setting('app.current_tenant', true) = '0'
  );
`);
await knex.raw(`
  CREATE POLICY shop_memberships_write_policy
  ON shop_memberships FOR ALL
  USING (shop_id = current_setting('app.current_tenant', true)::int)
  WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
`);

/**
 * NOTE:
 * Direct enforcement via shop_id
 * Memberships must never be visible across tenants
 */

  await knex.schema.createTable('operator_schedules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    /**
     * weekday: 0=Sun … 6=Sat
     * start_time / end_time: local time in shop timezone
     * effective_from / effective_to: template versioning — allows schedule history
     */
    table.smallint('weekday').notNullable();
    table.time('start_time').notNullable();
    table.time('end_time').notNullable();
    table.date('effective_from').notNullable();
    table.date('effective_to').nullable();
    table.timestamps(true, true);
    table.index(['shop_id', 'user_id']);
    table.index(['shop_id', 'weekday']);
  });

  await knex.raw(`
    ALTER TABLE operator_schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE operator_schedules FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS operator_schedules_tenant_isolation_policy ON operator_schedules;
  `);

  await knex.raw(`
    CREATE POLICY operator_schedules_tenant_isolation_policy
    ON operator_schedules
    USING (shop_id = current_setting('app.current_tenant', true)::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('operator_schedules');
  await knex.schema.dropTableIfExists('shop_memberships');
}
