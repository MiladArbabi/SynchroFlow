/**
 * Schema fix: recreates activation_audit_events with correct columns.
 * RLS applied here — shop_id is nullable but tenant-scoped rows must be isolated.
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('activation_audit_events');
  if (exists) {
    await knex.schema.dropTable('activation_audit_events');
  }

  await knex.schema.createTable('activation_audit_events', (table) => {
    /**
     * Sovereign activation audit log.
     * Append-only.
     */

    table.uuid('event_id').primary();

    table.string('event_type').notNullable();

    table.integer('shop_id')
      .nullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.integer('user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('occurred_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    table.jsonb('payload').notNullable();

    table.index(['shop_id']);
    table.index(['user_id']);
    table.index(['event_type']);
    table.index(['occurred_at']);

    });

  // --- RLS: tenant isolation ---
  // shop_id is nullable (system events have no shop). Policy allows nulls through
  // so system-level rows remain readable by the service role, but tenant rows
  // are strictly isolated by shop_id.
  await knex.raw(`
    ALTER TABLE activation_audit_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE activation_audit_events FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS activation_audit_events_tenant_isolation_policy ON activation_audit_events;
    CREATE POLICY activation_audit_events_tenant_isolation_policy
    ON activation_audit_events
    USING (
      shop_id IS NULL
      OR shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activation_audit_events');
}
