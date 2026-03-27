import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_ingestion_events', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('module_id').notNullable();   // e.g. 'product'
    table.string('event').notNullable();       // e.g. 'ingested'

    table.timestamp('created_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.index(['shop_id', 'module_id']);
    /**
     * IDEMPOTENCY CONSTRAINT
     * ----------------------
     * Prevent duplicate ingestion signals.
     *
     * Guarantees:
     * - One signal per (shop, module, event)
     */
    table.unique(['shop_id', 'module_id', 'event']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_ingestion_events');
}