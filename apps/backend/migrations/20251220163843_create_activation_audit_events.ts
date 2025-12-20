//apps/backend/migrations/20251220163843_create_activation_audit_events.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('activation_audit_events', table => {
    table.increments('id').primary();
    table.timestamp('occurred_at').defaultTo(knex.fn.now());
    table.integer('user_id').nullable();
    table.integer('shop_id').nullable();
    table.string('entry_channel').nullable();
    table.string('verdict').notNullable();
    table.string('reason').nullable();
    table.jsonb('payload').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activation_audit_events');
}
