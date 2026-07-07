import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refund_execution_line_items', (table) => {
    table.dropForeign('lasyncro_refund_execution_id');
  });
  await knex.raw(`
    ALTER TABLE refund_execution_line_items
    ALTER COLUMN lasyncro_refund_execution_id DROP NOT NULL;
  `);
  await knex.schema.alterTable('refund_execution_line_items', (table) => {
    table
      .foreign('lasyncro_refund_execution_id')
      .references('lasyncro_refund_execution_id')
      .inTable('refund_executions')
      .onDelete('CASCADE');
  });
  // Same manual-intake marker pattern as return_jobs.source.
  await knex.schema.alterTable('refund_execution_line_items', (table) => {
    table.uuid('return_job_id').nullable()
      .references('return_job_id').inTable('return_jobs').onDelete('CASCADE');
    table.string('source', 50).notNullable().defaultTo('refund_webhook');
    // 'refund_webhook' | 'scan_intake_manual'
  });
  // Quantity and refunded_amount are notNullable today — must relax for
  // manual creation, where there is no refund yet to derive amount from.
  await knex.raw(`
    ALTER TABLE refund_execution_line_items ALTER COLUMN refunded_amount DROP NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refund_execution_line_items', (table) => {
    table.dropColumn('return_job_id');
    table.dropColumn('source');
  });
  await knex.raw(`
    DELETE FROM refund_execution_line_items WHERE lasyncro_refund_execution_id IS NULL;
    ALTER TABLE refund_execution_line_items ALTER COLUMN lasyncro_refund_execution_id SET NOT NULL;
    ALTER TABLE refund_execution_line_items ALTER COLUMN refunded_amount SET NOT NULL;
  `);
}