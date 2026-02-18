export async function up(knex) {
    await knex.schema.createTable('user_lifecycle_snapshot', table => {
        table
            .integer('user_id')
            .notNullable()
            .primary()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE');
        table
            .integer('shop_id')
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table
            .string('phase', 32)
            .notNullable();
        table
            .timestamp('since', { useTz: true })
            .notNullable();
        /**
         * last_event_id
         * -------------
         * Logical pointer to most recent lifecycle event.
         *
         * IMPORTANT:
         * - No FK constraint here.
         * - Snapshot must not be structurally coupled
         *   to a specific ledger implementation.
         * - Allows future switch from legacy
         *   lifecycle_audit_events → lifecycle_events
         *   without schema lock-in.
         */
        table
            .uuid('last_event_id')
            .notNullable();
        table
            .timestamp('updated_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.index(['phase'], 'user_lifecycle_snapshot_phase_idx');
    });
    await knex.raw(`
    ALTER TABLE user_lifecycle_snapshot
    ADD CONSTRAINT lifecycle_phase_valid
    CHECK (phase IN ('FT_MINUS_ONE', 'FT0', 'FT1', 'FT2'))
  `);
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('user_lifecycle_snapshot');
}
//# sourceMappingURL=20260213114609_0023_user_lifecycle_snapshot.js.map