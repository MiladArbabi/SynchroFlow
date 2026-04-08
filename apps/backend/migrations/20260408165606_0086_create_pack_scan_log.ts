import { Knex } from 'knex';

/**
 * MIGRATION 0086 — create_pack_scan_log
 * ---------------------------------------
 * Append-only log of every scan confirmed during a pack session.
 *
 * Pack scans verify order completeness before shipment:
 * - Single-item order: scan item → print label → pack → done
 * - Multi-item order: scan each item → all confirmed → print → pack
 *
 * Differences from pick_scan_log:
 * - No location_code — packer works from picked basket, not shelf
 * - Linked to lasyncro_order_id directly — pack is order-centric
 * - No inventory movement — deduction already written at pick scan
 *
 * Invariants:
 * - Append-only — no updates, no deletes
 * - One confirmed scan per line item per batch
 * - status 'undone' allows quantity correction before pack_complete
 */
export async function up(knex: Knex): Promise<void> {

  await knex.schema.createTable('pack_scan_log', (table) => {
    table
      .uuid('scan_id')
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
      .uuid('pick_batch_id')
      .notNullable()
      .references('pick_batch_id')
      .inTable('pick_batches')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_line_item_id')
      .notNullable()
      .references('lasyncro_line_item_id')
      .inTable('order_line_items')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable();

    table
      .integer('quantity_confirmed')
      .notNullable();

    /**
     * scan_status reused — confirmed | undone
     * Undone allows packer to correct before pack_complete.
     */
    table
      .specificType('status', 'scan_status')
      .notNullable()
      .defaultTo('confirmed');

    table
      .integer('scanned_by')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table
      .timestamp('scanned_at', { useTz: true })
      .notNullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['pick_batch_id']);
    table.index(['lasyncro_order_id']);
    table.index(['scanned_by']);
    table.index(['scanned_at']);
  });

  // Append-only enforcement
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_pack_scan_log_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'pack_scan_log is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER pack_scan_log_no_update
    BEFORE UPDATE ON pack_scan_log
    FOR EACH ROW EXECUTE FUNCTION prevent_pack_scan_log_mutation();

    CREATE TRIGGER pack_scan_log_no_delete
    BEFORE DELETE ON pack_scan_log
    FOR EACH ROW EXECUTE FUNCTION prevent_pack_scan_log_mutation();
  `);

  await knex.raw(`
    ALTER TABLE pack_scan_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pack_scan_log FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS pack_scan_log_tenant_isolation_policy ON pack_scan_log;
  `);

  await knex.raw(`
    CREATE POLICY pack_scan_log_tenant_isolation_policy
    ON pack_scan_log
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS pack_scan_log_no_update ON pack_scan_log;
    DROP TRIGGER IF EXISTS pack_scan_log_no_delete ON pack_scan_log;
    DROP FUNCTION IF EXISTS prevent_pack_scan_log_mutation();
  `);

  await knex.schema.dropTableIfExists('pack_scan_log');
}