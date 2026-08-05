import { Knex } from 'knex';

/**
 * Closes the final legacy tenant-isolation gap on activation_audit_events.
 *
 * Historical migration 0031 allowed shop_id IS NULL. Runtime writers now
 * always supply a concrete shop_id, and the pre-migration audit confirmed
 * that no existing rows contain a null tenant identifier.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF (
        SELECT COUNT(*)
        FROM activation_audit_events
      ) <> (
        SELECT COUNT(shop_id)
        FROM activation_audit_events
      ) THEN
        RAISE EXCEPTION
          '[0139_NULL_SHOP_ROWS] activation_audit_events contains rows without shop_id';
      END IF;
    END
    $$;

    ALTER TABLE activation_audit_events
      ALTER COLUMN shop_id SET NOT NULL;

    ALTER TABLE activation_audit_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE activation_audit_events FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS
      activation_audit_events_tenant_isolation_policy
      ON activation_audit_events;

    CREATE POLICY activation_audit_events_tenant_isolation_policy
      ON activation_audit_events
      FOR ALL
      USING (
        shop_id = NULLIF(
          current_setting('app.current_tenant', true),
          ''
        )::integer
      )
      WITH CHECK (
        shop_id = NULLIF(
          current_setting('app.current_tenant', true),
          ''
        )::integer
      );
  `);
}

/**
 * Security boundary migrations are intentionally forward-only.
 * Restoring the nullable column and permissive policy would reopen the issue.
 */
export async function down(_knex: Knex): Promise<void> {
  throw new Error(
    '[0139_DOWN_UNSUPPORTED] activation_audit_events tenant enforcement cannot be rolled back safely'
  );
}
