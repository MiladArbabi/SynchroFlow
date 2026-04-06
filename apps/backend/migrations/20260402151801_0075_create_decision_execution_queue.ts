import { Knex } from 'knex';

/**
 * decision_execution_queue
 * ------------------------
 * PURPOSE:
 * - Stores manual execution decisions
 * - Enables user-triggered execution
 *
 * INVARIANTS:
 * - decision_id is unique (1 decision = 1 pending execution)
 * - status tracks lifecycle: pending → dispatched → in_progress → success | failure
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('decision_execution_queue', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    /**
     * INVARIANT (CRITICAL)
     * --------------------
     * One decision = one execution entry.
     * Prevents duplicate manual execution.
     */
    table.string('decision_id').notNullable().unique();
    table.string('status').notNullable(); // 'pending' | 'dispatched' | 'in_progress' | 'success' | 'failure'

    table.integer('shop_id').notNullable();

    table.index(['shop_id'], 'idx_decision_execution_queue_shop_id');

    table.text('error').nullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('executed_at').nullable();

  });

  /**
   * RLS (MANDATORY)
   */
  await knex.raw(`
    ALTER TABLE decision_execution_queue ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY decision_execution_queue_isolation
    ON decision_execution_queue
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('decision_execution_queue');
}