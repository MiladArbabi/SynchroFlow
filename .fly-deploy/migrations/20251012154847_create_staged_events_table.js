"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('staged_events', (table) => {
        table.increments('id').primary();
        table.string('source_platform').notNullable().index();
        table.string('event_type').notNullable();
        table.jsonb('raw_payload').notNullable();
        table
            .enum('status', ['received', 'processing', 'completed', 'failed'], {
            useNative: true,
            enumName: 'event_status_type',
        })
            .notNullable()
            .defaultTo('received');
        table.timestamps(true, true);
    });
}
async function down(knex) {
    await knex.schema.dropTable('staged_events');
    await knex.raw('DROP TYPE IF EXISTS event_status_type');
}
