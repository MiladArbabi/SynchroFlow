"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('shopify_payouts', (table) => {
        table.increments('id').primary();
        table
            .integer('shop_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table.string('platform_payout_id').notNullable();
        table.string('status'); // e.g., 'paid', 'pending'
        table.timestamp('date').notNullable();
        table.string('currency', 3).notNullable();
        table.decimal('amount', 10, 2).notNullable(); // Total payout amount
        table.decimal('fees', 10, 2).notNullable().defaultTo(0); // The critical "fees"
        table.decimal('net_amount', 10, 2).notNullable();
        table.timestamps(true, true);
        table.unique(['shop_id', 'platform_payout_id']);
        table.index(['shop_id']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('shopify_payouts');
}
