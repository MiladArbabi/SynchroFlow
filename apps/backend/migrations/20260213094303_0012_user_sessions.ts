import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_sessions', (table) => {
    table.string('sid').primary();
    // --- TENANT ANCHOR (MANDATORY) ---
    // Required because sess JSON cannot be used for RLS enforcement
    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.index(['user_id']);

    table.json('sess').notNullable();
    table.timestamp('expire', { useTz: true }).notNullable();
  });

  await knex.raw(`
    CREATE INDEX user_sessions_expire_idx
    ON user_sessions (expire);
  `);

  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS user_sessions_tenant_isolation_policy ON user_sessions;
  `);

  await knex.raw(`
    CREATE POLICY user_sessions_tenant_isolation_policy
    ON user_sessions
    USING (
      user_id IN (
        SELECT id FROM users
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_sessions');
}
