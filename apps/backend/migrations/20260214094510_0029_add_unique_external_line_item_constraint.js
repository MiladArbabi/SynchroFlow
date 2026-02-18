export async function up(knex) {
    await knex.schema.alterTable('order_line_items', (table) => {
        table.unique(['platform', 'external_line_item_id'], 'order_line_items_platform_external_line_unique');
    });
}
export async function down(knex) {
    await knex.schema.alterTable('order_line_items', (table) => {
        table.dropUnique(['platform', 'external_line_item_id'], 'order_line_items_platform_external_line_unique');
    });
}
//# sourceMappingURL=20260214094510_0029_add_unique_external_line_item_constraint.js.map