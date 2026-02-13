import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', (table) => {
    table.string('platform', 50).notNullable();
    table.string('platform_order_id', 255).notNullable();

    table.unique(
      ['shop_id', 'platform', 'platform_order_id'],
      'orders_shop_platform_platform_order_unique'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders', (table) => {
    table.dropUnique(
      ['shop_id', 'platform', 'platform_order_id'],
      'orders_shop_platform_platform_order_unique'
    );

    table.dropColumn('platform');
    table.dropColumn('platform_order_id');
  });
}
