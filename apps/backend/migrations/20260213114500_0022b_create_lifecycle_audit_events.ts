import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('lifecycle_audit_events', (table) => {
    table.uuid('event_id').primary();
    table.integer('user_id').notNullable();
    table.integer('shop_id').notNullable();
    table.string('from_phase').notNullable();
    table.string('to_phase').notNullable();
    table.timestamp('occurred_at').notNullable().defaultTo(knex.fn.now());

    table.unique(
      ['user_id', 'from_phase', 'to_phase'],
      'lifecycle_audit_unique_transition'
    );

    table.index(['user_id']);
    table.index(['shop_id']);
    table.index(['occurred_at']);
    table.index(
      ['user_id', 'occurred_at'],
      'lifecycle_audit_user_occurred_at_idx'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('lifecycle_audit_events');
}
