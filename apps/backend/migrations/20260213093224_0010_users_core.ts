import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();

    /**
     * Shop ownership
     * --------------
     * Required by:
     * - sync worker
     * - lifecycle evaluator
     * - onboarding readiness providers
     *
     * 1 user → 1 shop (current invariant)
     */
    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.index(['shop_id']);

    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();

    table.string('first_name');
    table.string('last_name');

    /**
     * User state tracking (baked-in baseline)
     * ----------------------------------------
     * These existed in legacy migrations and are
     * required by sync + lifecycle workers.
     */
    table.enum('preferred_mode', ['survival', 'growth', 'architect']).defaultTo('survival');
    table.enum('detected_mode', ['survival', 'growth', 'architect']).defaultTo('survival');

    table.boolean('shopify_connected').defaultTo(false);
    table.boolean('stripe_connected').defaultTo(false);

    table.string('orders_per_month_segment', 20);
    table.string('entry_channel').defaultTo('unknown');

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['email']);
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  await knex.raw(`
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE users FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS users_tenant_isolation_policy ON users;
  `);

  await knex.raw(`
    CREATE POLICY users_tenant_isolation_policy
    ON users
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // NOTE:
  // 1 user → 1 shop invariant → safe direct enforcement
  // Protects auth credentials from cross-tenant access

  // ============================
  // USER STATES (Onboarding KV)
  // ============================
  await knex.schema.createTable('user_states', (table) => {
    table.increments('id').primary();

    table.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.string('key').notNullable();
    table.text('value');

    table.timestamps(true, true);

    table.unique(['user_id', 'key']);
  });

  // --- RLS: Enforce tenant isolation (via users) ---
  await knex.raw(`
    ALTER TABLE user_states ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_states FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS user_states_tenant_isolation_policy ON user_states;
  `);

  await knex.raw(`
    CREATE POLICY user_states_tenant_isolation_policy
    ON user_states
    USING (
      user_id IN (
        SELECT id
        FROM users
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // NOTE:
  // Enforced via users → ensures state never leaks across tenants
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_states');
  await knex.schema.dropTableIfExists('users');
}
