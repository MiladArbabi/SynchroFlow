/**
 * ============================================================
 * FT0 STATE (SOVEREIGN)
 * ============================================================
 *
 * Represents system-readiness completion per shop.
 *
 * Invariants:
 * - Exactly one row per shop
 * - Idempotent completion
 * - Completion is irreversible
 */
export async function up(knex) {
    await knex.schema.createTable('ft0_state', table => {
        /**
         * shop_id is the primary identity.
         * Exactly one row per shop.
         */
        table
            .integer('shop_id')
            .notNullable()
            .primary()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table
            .string('status')
            .notNullable(); // e.g. COMPLETED
        table
            .timestamp('completed_at')
            .nullable();
        table
            .jsonb('completion_reason')
            .notNullable()
            .defaultTo('{}');
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('ft0_state');
}
//# sourceMappingURL=20260214102848_0032_create_ft0_state.js.map