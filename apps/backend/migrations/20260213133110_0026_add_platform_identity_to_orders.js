export async function up(knex) {
    await knex.schema.alterTable('orders', (table) => {
        table.string('platform', 50).notNullable();
        table.string('platform_order_id', 255).notNullable();
        table.unique(['shop_id', 'platform', 'platform_order_id'], 'orders_shop_platform_platform_order_unique');
    });
}
export async function down(knex) {
    await knex.schema.alterTable('orders', (table) => {
        table.dropUnique(['shop_id', 'platform', 'platform_order_id'], 'orders_shop_platform_platform_order_unique');
        table.dropColumn('platform');
        table.dropColumn('platform_order_id');
    });
}
//# sourceMappingURL=20260213133110_0026_add_platform_identity_to_orders.js.map