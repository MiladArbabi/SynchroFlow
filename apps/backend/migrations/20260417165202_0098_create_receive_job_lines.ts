import { Knex } from 'knex';

/**
 * MIGRATION 0098 — create_receive_job_lines
 * ------------------------------------------
 * One row per variant per receive job.
 * Tracks inspection progress and accepted/rejected counts.
 *
 * Links back to purchase_order_line_items for ordered qty context.
 * quantity_accepted written back to purchase_order_line_items.quantity_received on job close.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('receive_job_lines', (table) => {
    table
      .uuid('receive_job_line_id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('receive_job_id')
      .notNullable()
      .references('receive_job_id')
      .inTable('receive_jobs')
      .onDelete('CASCADE');

    /**
     * FK to purchase_order_line_items for ordered qty reference.
     * Nullable — future: manually added lines not on original PO.
     */
    table
      .uuid('po_line_item_id')
      .nullable()
      .references('id')
      .inTable('purchase_order_line_items')
      .onDelete('SET NULL');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    table.integer('quantity_expected').notNullable();
    table.integer('quantity_accepted').notNullable().defaultTo(0);
    table.integer('quantity_rejected').notNullable().defaultTo(0);

    /**
     * Inspection complete when quantity_accepted + quantity_rejected = quantity_expected.
     * Set explicitly by operator confirming the batch — not auto-derived.
     */
    table.boolean('inspection_complete').notNullable().defaultTo(false);

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['receive_job_id', 'lasyncro_variant_id'], 'receive_job_lines_unique');

    table.index(['shop_id']);
    table.index(['receive_job_id']);
    table.index(['lasyncro_variant_id']);
  });

  await knex.raw(`ALTER TABLE receive_job_lines ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE receive_job_lines FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS receive_job_lines_tenant_isolation_policy ON receive_job_lines;`);
  await knex.raw(`
    CREATE POLICY receive_job_lines_tenant_isolation_policy
    ON receive_job_lines
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('receive_job_lines');
}