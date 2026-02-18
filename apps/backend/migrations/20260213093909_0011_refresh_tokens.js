// apps/backend/migrations/20260213093909_0011_refresh_tokens.ts
export async function up(knex) {
    await knex.schema.createTable('refresh_tokens', (table) => {
        table.increments('id').primary();
        // ───────────────────────────────────────────
        // Identity anchors
        // ───────────────────────────────────────────
        table
            .integer('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE');
        table
            .integer('shop_id')
            .nullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table.uuid('session_id').notNullable();
        table.integer('token_version').notNullable().defaultTo(1);
        // ───────────────────────────────────────────
        // Security
        // ───────────────────────────────────────────
        table.string('token_hash', 255).notNullable();
        table.timestamp('expires_at', { useTz: true }).notNullable();
        table.timestamp('revoked_at', { useTz: true }).nullable();
        table.timestamp('created_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        // ───────────────────────────────────────────
        // Indexes
        // ───────────────────────────────────────────
        table.index(['user_id'], 'refresh_tokens_user_id_idx');
        table.index(['shop_id'], 'refresh_tokens_shop_id_idx');
        table.index(['session_id'], 'refresh_tokens_session_id_idx');
        table.index(['token_hash'], 'refresh_tokens_token_hash_idx');
        table.index(['user_id', 'session_id'], 'refresh_tokens_user_session_idx');
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('refresh_tokens');
}
//# sourceMappingURL=20260213093909_0011_refresh_tokens.js.map