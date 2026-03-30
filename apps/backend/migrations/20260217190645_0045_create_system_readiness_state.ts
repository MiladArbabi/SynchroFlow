import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('system_readiness_state', table => {
    table
      .integer('shop_id')
      .notNullable()
      .primary()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .timestamp('became_ready_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['became_ready_at'], 'system_readiness_ready_at_idx');
  });

  // --- RLS: enforce tenant isolation (REQUIRED: table has shop_id) ---
  await knex.raw(`
    ALTER TABLE system_readiness_state ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY system_readiness_state_tenant_isolation
    ON system_readiness_state
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

/**
 * Absence of row = UNREADY
 * Presence of row = READY
 *
 * READY is irreversible.
 */
export async function down(knex: Knex): Promise<void> {
  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS system_readiness_state_tenant_isolation ON system_readiness_state;
  `);
  
  await knex.schema.dropTableIfExists('system_readiness_state');
}
