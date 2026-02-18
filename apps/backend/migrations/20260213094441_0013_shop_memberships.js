export async function up(knex) {
    await knex.schema.createTable('shop_memberships', (table) => {
        table.increments('id').primary();
        table
            .integer('shop_id')
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table
            .integer('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE');
        table.string('role', 50).notNullable(); // e.g. admin, operator, viewer
        table.timestamps(true, true);
        table.unique(['shop_id', 'user_id']);
        table.index(['user_id']);
        table.index(['shop_id']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('shop_memberships');
}
//# sourceMappingURL=20260213094441_0013_shop_memberships.js.map