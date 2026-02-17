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
}

/**
 * Absence of row = Not yet evaluated.
 * Presence of row = Durable eligibility fact.
 */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(
    'expansion_eligibility_state'
  );
}
