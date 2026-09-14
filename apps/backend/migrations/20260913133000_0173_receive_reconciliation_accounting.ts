import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE receive_exception_type ADD VALUE IF NOT EXISTS 'missing_item';
    ALTER TYPE receive_exception_type ADD VALUE IF NOT EXISTS 'extra_item';
  `);

  await knex.schema.alterTable('receive_exceptions', (table) => {
    table.text('accounting_role').nullable();
    table.boolean('counts_toward_shortfall').notNullable().defaultTo(false);
  });

  await knex.raw(`
    UPDATE receive_exceptions
    SET
      accounting_role = CASE
        WHEN exception_type IN ('defect', 'wrong_item', 'wrong_variant') THEN 'shortfall'
        ELSE accounting_role
      END,
      counts_toward_shortfall = CASE
        WHEN exception_type IN ('defect', 'wrong_item', 'wrong_variant') THEN true
        ELSE counts_toward_shortfall
      END
    WHERE accounting_role IS NULL
      AND counts_toward_shortfall = false
      AND exception_type IN ('defect', 'wrong_item', 'wrong_variant');
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('receive_exceptions', (table) => {
    table.dropColumn('counts_toward_shortfall');
    table.dropColumn('accounting_role');
  });
}
