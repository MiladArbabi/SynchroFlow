export async function up(knex) {
    await knex.schema.createTable('integration_oauth_states', (table) => {
        table.increments('id').primary();
        // Who initiated the OAuth flow
        table
            .integer('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE');
        // Target platform (e.g. 'shopify')
        table.string('platform').notNullable();
        // CSRF / OAuth state
        table.string('state').notNullable();
        // Optional: normalized shop domain (e.g. my-store.myshopify.com)
        table.string('shop_domain');
        // Hard expiration for the OAuth attempt
        table.timestamp('expires_at', { useTz: true }).notNullable();
        // Auditability
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        // --- Constraints ---
        table.unique(['platform', 'state']);
        table.index(['user_id', 'platform']);
        table.index(['expires_at']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('integration_oauth_states');
}
//# sourceMappingURL=20260213114034_0021_integration_oauth_states.js.map