import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('lifecycle_events', table => {
    table
      .uuid('event_id')
      .primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .integer('user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table
      .string('layer', 64)
      .notNullable();

    table
      .string('event_type', 128)
      .notNullable();

    table
      .jsonb('payload')
      .notNullable();

    table
      .timestamp('occurred_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id'], 'lifecycle_events_shop_idx');
    table.index(['user_id'], 'lifecycle_events_user_idx');
    table.index(['layer'], 'lifecycle_events_layer_idx');
  });

  // --- RLS: enforce tenant isolation (REQUIRED: table has shop_id) ---
  await knex.raw(`
    ALTER TABLE lifecycle_events ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY lifecycle_events_tenant_isolation
    ON lifecycle_events
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

/**
 * Append-only lifecycle backbone.
 * Replaces lifecycle_audit_events.
 * Supports multi-layer v2 state model.
 */
export async function down(knex: Knex): Promise<void> {
  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS lifecycle_events_tenant_isolation ON lifecycle_events;
  `);
  await knex.schema.dropTableIfExists('lifecycle_events');
}
