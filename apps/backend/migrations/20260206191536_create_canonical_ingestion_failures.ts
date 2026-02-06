import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('canonical_ingestion_failures', (table) => {
    table.bigIncrements('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.text('platform').notNullable();
    table.text('platform_order_id').notNullable();

    table.text('failure_reason').notNullable();
    table.text('failure_stage').notNullable();

    table.jsonb('evidence').notNullable();

    table.uuid('ingestion_run_id').nullable();
    table.text('source_event_id').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['shop_id', 'platform', 'platform_order_id', 'failure_reason']);
    table.index(['shop_id', 'created_at'], 'idx_cif_shop_created');
    table.index(['failure_reason'], 'idx_cif_reason');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('canonical_ingestion_failures');
}
