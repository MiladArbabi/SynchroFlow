export async function up(knex) {
    await knex.schema.createTable("ft2_state", (table) => {
        /**
         * shop_id is the primary identity.
         * Exactly one row per shop.
         */
        table
            .integer("shop_id")
            .notNullable()
            .primary()
            .references("id")
            .inTable("shops")
            .onDelete("CASCADE");
        table.timestamp("completed_at", { useTz: true }).nullable();
        table.string("evaluator_version", 255).nullable();
        table
            .jsonb("evaluation_snapshot")
            .notNullable()
            .defaultTo("{}");
        table
            .timestamp("created_at", { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists("ft2_state");
}
//# sourceMappingURL=20260214130606_0034_create_ft2_state.js.map