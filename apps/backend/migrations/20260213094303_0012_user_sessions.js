export async function up(knex) {
    await knex.schema.createTable('user_sessions', (table) => {
        table.string('sid').primary();
        table.json('sess').notNullable();
        table.timestamp('expire', { useTz: true }).notNullable();
    });
    await knex.raw(`
    CREATE INDEX user_sessions_expire_idx
    ON user_sessions (expire);
  `);
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('user_sessions');
}
//# sourceMappingURL=20260213094303_0012_user_sessions.js.map