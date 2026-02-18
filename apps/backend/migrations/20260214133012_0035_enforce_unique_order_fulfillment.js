export async function up(knex) {
    await knex.schema.alterTable('order_fulfillment_status', (table) => {
        table.unique(['lasyncro_order_id'], {
            indexName: 'order_fulfillment_status_order_unique',
        });
    });
}
export async function down(knex) {
    await knex.schema.alterTable('order_fulfillment_status', (table) => {
        table.dropUnique(['lasyncro_order_id'], 'order_fulfillment_status_order_unique');
    });
}
//# sourceMappingURL=20260214133012_0035_enforce_unique_order_fulfillment.js.map