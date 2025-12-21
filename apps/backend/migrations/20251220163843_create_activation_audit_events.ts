import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('activation_audit_events', table => {
    table.increments('id').primary();

    table.timestamp('occurred_at').defaultTo(knex.fn.now());

    table.integer('user_id').nullable();
    table.integer('shop_id').nullable();

    // IDENTITY CONTEXT (locked)
    table.string('entry_channel').notNullable();

    // VERDICT
    table.string('verdict').notNullable();
    table.string('reason').nullable();

    // AUDIT CORE
    table.string('derivation_version').notNullable();
    table.jsonb('payload').notNullable();
    table.string('payload_hash').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activation_audit_events');
}
