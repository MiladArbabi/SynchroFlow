export async function up(knex) {
    await knex.schema.createTable('customers', (table) => {
        table.increments('id').primary();
        table
            .integer('shop_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table.string('external_customer_id').nullable();
        table.string('email').nullable();
        table.string('first_name').nullable();
        table.string('last_name').nullable();
        table.timestamp('created_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.index(['shop_id']);
        table.index(['email']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('customers');
}
//# sourceMappingURL=20260213095252_0017_customers.js.map