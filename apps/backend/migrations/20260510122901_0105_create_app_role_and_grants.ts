// @rls-exempt — no tenant tables created; grants and role management only
import type { Knex } from 'knex';
/**
 * APP ROLE & GRANTS (SECURITY)
 * ----------------------------
 * Creates the restricted runtime role sf_app.
 *
 * WHY:
 * - sf_user is a superuser with BYPASSRLS=true
 * - All app runtime queries must use sf_app (RLS enforced)
 * - sf_user is reserved for migrations only
 *
 * sf_app:
 * - No superuser, no BYPASSRLS
 * - SELECT/INSERT/UPDATE/DELETE on all tables
 * - Subject to all RLS policies
 *
 * CREDENTIALS: sf_app / sf_app_pass
 * Set PGUSER=sf_app, PGPASSWORD=sf_app_pass in .env
 * Set PGMIGRATION_USER=sf_user for knexfile.cjs
 */
export async function up(knex: Knex): Promise<void> {
  // Create role if not exists (idempotent)
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sf_app') THEN
        CREATE USER sf_app WITH PASSWORD 'sf_app_pass'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
      END IF;
    END
    $$;
  `);

  const { rows } = await knex.raw(`SELECT current_database() as db`);
  const dbName = rows[0].db;
  await knex.raw(`GRANT CONNECT ON DATABASE "${dbName}" TO sf_app`);
  await knex.raw(`GRANT USAGE ON SCHEMA public TO sf_app`);
  await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sf_app`);
  await knex.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sf_app`);
  await knex.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sf_app`);
  await knex.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sf_app`);

  // Register app.current_tenant GUC at database level
  // Required so sf_app (non-superuser) can SET/SHOW this parameter
  await knex.raw(`ALTER DATABASE "${dbName}" SET app.current_tenant = '0'`);
}

export async function down(knex: Knex): Promise<void> {
  // Revoke grants — role itself is left intact (DROP USER requires no owned objects)
  await knex.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sf_app`);
  await knex.raw(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM sf_app`);
  await knex.raw(`REVOKE USAGE ON SCHEMA public FROM sf_app`);
  const { rows } = await knex.raw(`SELECT current_database() as db`);
  await knex.raw(`REVOKE CONNECT ON DATABASE "${rows[0].db}" FROM sf_app`);
}
