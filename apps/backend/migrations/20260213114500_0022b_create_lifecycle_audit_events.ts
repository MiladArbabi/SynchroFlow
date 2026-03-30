import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('lifecycle_audit_events', (table) => {
    table.uuid('event_id').primary();
    table.integer('user_id').notNullable();
    table.integer('shop_id').notNullable();
    table.string('from_phase').notNullable();
    table.string('to_phase').notNullable();
    table.timestamp('occurred_at').notNullable().defaultTo(knex.fn.now());

    /**
     * DESIGN CONTRACT (v3):
     * Lifecycle is SHOP-SCOPED.
     * Prevent duplicate shop-level transitions.
     */
    table.unique(
      ['shop_id', 'from_phase', 'to_phase'],
      'lifecycle_audit_unique_transition'
    );

    table.index(['user_id']);
    table.index(['shop_id']);
    table.index(['occurred_at']);
    table.index(
      ['user_id', 'occurred_at'],
      'lifecycle_audit_user_occurred_at_idx'
    );
  });

  // --- RLS: Enforce tenant isolation (direct via shop_id) ---
  // Lifecycle is shop-scoped → shop_id is authoritative boundary
  // Prevents cross-tenant lifecycle leakage (critical for state machines)
  await knex.raw(`
    ALTER TABLE lifecycle_audit_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lifecycle_audit_events FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS lifecycle_audit_events_tenant_isolation_policy ON lifecycle_audit_events;
  `);

  await knex.raw(`
    CREATE POLICY lifecycle_audit_events_tenant_isolation_policy
    ON lifecycle_audit_events
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  /**
   * NOTE:
   * Direct enforcement via shop_id
   * Lifecycle transitions must be strictly tenant-isolated
   */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('lifecycle_audit_events');
}
