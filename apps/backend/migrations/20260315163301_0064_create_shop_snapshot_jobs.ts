import { Knex } from 'knex';

/**
 * SHOP SNAPSHOT JOB QUEUE
 * -----------------------
 * Schedules Control Tower snapshot recomputation.
 *
 * Architectural purpose:
 * - decouple reconciliation pipeline from snapshot worker
 * - deduplicate snapshot triggers
 * - allow worker-based execution
 *
 * Invariant:
 * one pending job per shop.
 */
export async function up(knex: Knex): Promise<void> {

  await knex.schema.createTable('shop_snapshot_jobs', (table) => {

    table
      .integer('shop_id')
      .primary()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .timestamp('scheduled_at', { useTz: true })
      .notNullable()
      .comment('Time snapshot recompute was requested');

  });

}

export async function down(knex: Knex): Promise<void> {

  await knex.schema.dropTableIfExists('shop_snapshot_jobs');

}