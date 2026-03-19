import { Knex } from 'knex';

/**
 * BLOCK LIFECYCLE TRACKING
 * ------------------------
 * Adds timestamps for:
 * - when a block starts
 * - when it resolves
 *
 * Applies to both operational + customer constraints.
 *
 * NOTE:
 * This is required for:
 * - observability
 * - SLA analytics
 * - future constraint optimization
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.timestamp('block_started_at').nullable();
    table.timestamp('block_resolved_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.dropColumn('block_started_at');
    table.dropColumn('block_resolved_at');
  });
}