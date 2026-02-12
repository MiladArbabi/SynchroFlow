import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orders_v2', (table) => {
    table.uuid('lasyncro_order_id').primary();

    table.integer('shop_id').notNullable();
    table.text('payment_state').notNullable().defaultTo('unknown');

    table.string('currency').notNullable();
    table.decimal('total_price').notNullable();
    table.decimal('subtotal_price').notNullable();
    table.decimal('total_tax').notNullable();

    table.string('source');
    table.string('referrer_medium');
    table.string('customer_hashed_id');

    table.timestamp('order_created_at', { useTz: true }).notNullable();
    table.timestamp('order_updated_at', { useTz: true }).notNullable();
    table.timestamp('order_processed_at', { useTz: true });

    table.timestamp('created_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.index(['shop_id', 'order_created_at']);
    table.index(['shop_id', 'customer_hashed_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('orders_v2');
}

