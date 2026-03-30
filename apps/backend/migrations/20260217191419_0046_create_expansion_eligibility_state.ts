import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('expansion_eligibility_state', table => {
    table
      .integer('shop_id')
      .notNullable()
      .primary()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .boolean('eligible')
      .notNullable();

    table
      .string('evaluator_version', 64)
      .notNullable();

    table
      .jsonb('evaluation_snapshot')
      .notNullable();

    table
      .timestamp('evaluated_at', { useTz: true })
      .notNullable();

    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(
      ['eligible'],
      'expansion_eligibility_eligible_idx'
    );
  });

  // --- RLS: enforce tenant isolation (REQUIRED: table has shop_id) ---
  await knex.raw(`
    ALTER TABLE expansion_eligibility_state ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY expansion_eligibility_state_tenant_isolation
    ON expansion_eligibility_state
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

/**
 * Absence of row = Not yet evaluated.
 * Presence of row = Durable eligibility fact.
 */
export async function down(knex: Knex): Promise<void> {
  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS expansion_eligibility_state_tenant_isolation ON expansion_eligibility_state;
  `);
  
  await knex.schema.dropTableIfExists(
    'expansion_eligibility_state'
  );
}
