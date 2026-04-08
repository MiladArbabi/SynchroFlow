import { Knex } from 'knex';

/**
 * MIGRATION 0082 — create_pick_batch_orders
 * ------------------------------------------
 * Join table linking orders to their assigned pick batch.
 *
 * Invariants:
 * - Full orders only — one order belongs to exactly one batch at a time
 * - Unique constraint on lasyncro_order_id prevents split-order across batches
 * - shop_id denormalized for direct RLS enforcement
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pick_batch_orders', (table) => {
    table
      .uuid('pick_batch_id')
      .notNullable()
      .references('pick_batch_id')
      .inTable('pick_batches')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.primary(['pick_batch_id', 'lasyncro_order_id']);

    /**
     * Prevents the same order appearing in multiple batches simultaneously.
     */
    table.unique(['lasyncro_order_id'], 'pick_batch_orders_order_unique');

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['pick_batch_id']);
  });

  await knex.raw(`
    ALTER TABLE pick_batch_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pick_batch_orders FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS pick_batch_orders_tenant_isolation_policy ON pick_batch_orders;
  `);

  await knex.raw(`
    CREATE POLICY pick_batch_orders_tenant_isolation_policy
    ON pick_batch_orders
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pick_batch_orders');
}