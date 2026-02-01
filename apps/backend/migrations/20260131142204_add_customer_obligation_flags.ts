import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasEvaluatedAt = await knex.schema.hasColumn(
    'order_fulfillment_status',
    'customer_block_evaluated_at'
  );

  if (!hasEvaluatedAt) {
    await knex.schema.alterTable('order_fulfillment_status', (table) => {
      /**
       * Customer Obligation v3
       * ----------------------
       * Explicit evaluation timestamp.
       * Required to distinguish:
       * - unknown (NULL)
       * - evaluated false
       * - evaluated true
       */
      table.timestamp('customer_block_evaluated_at').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasEvaluatedAt = await knex.schema.hasColumn(
    'order_fulfillment_status',
    'customer_block_evaluated_at'
  );

  if (hasEvaluatedAt) {
    await knex.schema.alterTable('order_fulfillment_status', (table) => {
      table.dropColumn('customer_block_evaluated_at');
    });
  }
}