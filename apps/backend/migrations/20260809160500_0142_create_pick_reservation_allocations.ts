import type { Knex } from 'knex';

/**
 * MIGRATION 0142 — create_pick_reservation_allocations
 * -----------------------------------------------------
 * Persists order-line ownership for inventory reserved during WMS batch release.
 *
 * The existing inventory_movements reservation_hold remains the aggregate
 * inventory ledger entry at batch + variant + location level.
 *
 * This table records the deterministic ownership breakdown:
 *   batch -> order -> line item -> variant -> location -> quantity
 *
 * It is intentionally an operational allocation table, not a replacement
 * for the immutable inventory ledger.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pick_reservation_allocations', (table) => {
    table
      .uuid('allocation_id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

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
      .uuid('lasyncro_line_item_id')
      .notNullable()
      .references('lasyncro_line_item_id')
      .inTable('order_line_items')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    table.string('location_code', 255).notNullable();
    table.integer('quantity').notNullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(
      [
        'shop_id',
        'pick_batch_id',
        'lasyncro_line_item_id',
        'location_code',
      ],
      {
        indexName: 'pick_res_alloc_line_location_unique',
      }
    );

    table.index(
      ['shop_id', 'pick_batch_id'],
      'pick_res_alloc_shop_batch_idx'
    );

    table.index(
      ['shop_id', 'lasyncro_order_id'],
      'pick_res_alloc_shop_order_idx'
    );

    table.index(
      ['shop_id', 'lasyncro_line_item_id'],
      'pick_res_alloc_shop_line_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE pick_reservation_allocations
      ADD CONSTRAINT pick_res_alloc_location_fk
      FOREIGN KEY (shop_id, location_code)
      REFERENCES warehouse_locations(shop_id, location_code)
      ON DELETE RESTRICT;

    ALTER TABLE pick_reservation_allocations
      ADD CONSTRAINT pick_res_alloc_quantity_positive
      CHECK (quantity > 0);

    ALTER TABLE pick_reservation_allocations
      ENABLE ROW LEVEL SECURITY;

    ALTER TABLE pick_reservation_allocations
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY pick_reservation_allocations_tenant_isolation_policy
      ON pick_reservation_allocations
      FOR ALL
      USING (
        shop_id = NULLIF(
          current_setting('app.current_tenant', true),
          ''
        )::integer
        AND NULLIF(
          current_setting('app.current_tenant', true),
          ''
        )::integer > 0
      )
      WITH CHECK (
        shop_id = NULLIF(
          current_setting('app.current_tenant', true),
          ''
        )::integer
        AND NULLIF(
          current_setting('app.current_tenant', true),
          ''
        )::integer > 0
      );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pick_reservation_allocations');
}
