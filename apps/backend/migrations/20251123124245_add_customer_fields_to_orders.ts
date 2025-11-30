// packages/api/migrations/20251123124245_add_customer_fields_to_orders.ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', (table) => {
    table.string('customer_name').nullable();
    table.string('customer_email').nullable();
    table.string('customer_phone').nullable();
    table.text('shipping_address').nullable(); // Store as JSON string
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', (table) => {
    table.dropColumn('customer_name');
    table.dropColumn('customer_email');
    table.dropColumn('customer_phone');
    table.dropColumn('shipping_address');
  });
}