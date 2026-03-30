/**
 * @rls-exempt
 * Schema fix migration (no new tenant table)
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('activation_audit_events');
  if (exists) {
    await knex.schema.dropTable('activation_audit_events');
  }

  await knex.schema.createTable('activation_audit_events', (table) => {
    /**
     * Sovereign activation audit log.
     * Append-only.
     */

    table.uuid('event_id').primary();

    table.string('event_type').notNullable();

    table.integer('shop_id')
      .nullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.integer('user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('occurred_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    table.jsonb('payload').notNullable();

    table.index(['shop_id']);
    table.index(['user_id']);
    table.index(['event_type']);
    table.index(['occurred_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activation_audit_events');
}
