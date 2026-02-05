import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_revenue_units', (t) => {
    t.integer('returned_quantity').nullable();
    t.boolean('has_return_block').nullable();
    t.text('return_block_reason').nullable();
    t.timestamp('return_evaluated_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_revenue_units', (t) => {
    t.dropColumn('returned_quantity');
    t.dropColumn('has_return_block');
    t.dropColumn('return_block_reason');
    t.dropColumn('return_evaluated_at');
  });
}