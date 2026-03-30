import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {

  // -------------------------------------------------------
  // 1️⃣ Customer blocking events
  // -------------------------------------------------------
  await knex.schema.createTable('customer_blocking_events', (table) => {

    table
     .uuid('lasyncro_customer_block_id')
     .primary()

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.text('reason').notNullable();

    table.boolean('is_active')
      .notNullable()
      .defaultTo(true);

    table.timestamp('evaluated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
  });

  // --- RLS: Enforce tenant isolation (via orders) ---
  await knex.raw(`
    ALTER TABLE customer_blocking_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE customer_blocking_events FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS customer_blocking_events_tenant_isolation_policy ON customer_blocking_events;
  `);

  await knex.raw(`
    CREATE POLICY customer_blocking_events_tenant_isolation_policy
    ON customer_blocking_events
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id
        FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  /**
   * NOTE:
   * No shop_id → enforced via orders (authoritative tenant anchor)
   */

  // -------------------------------------------------------
  // 2️⃣ Operational blocking events
  // -------------------------------------------------------
  await knex.schema.createTable('operational_blocking_events', (table) => {

    table
     .uuid('lasyncro_operational_block_id')
     .primary()

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.text('reason').notNullable();

    table.boolean('is_active')
      .notNullable()
      .defaultTo(true);

    table.timestamp('evaluated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
  });

  // --- RLS: Enforce tenant isolation (via orders) ---
  await knex.raw(`
    ALTER TABLE operational_blocking_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE operational_blocking_events FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS operational_blocking_events_tenant_isolation_policy ON operational_blocking_events;
  `);

  await knex.raw(`
    CREATE POLICY operational_blocking_events_tenant_isolation_policy
    ON operational_blocking_events
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id
        FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  /**
   * NOTE:
   * No shop_id → enforced via orders (authoritative tenant anchor)
   */

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('operational_blocking_events');
  await knex.schema.dropTableIfExists('customer_blocking_events');
}
