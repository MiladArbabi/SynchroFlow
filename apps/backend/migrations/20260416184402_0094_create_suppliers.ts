import { Knex } from 'knex';

/**
 * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE
 * moq and lead_time_days were added to this file. Knex marks this
 * migration complete and will NEVER re-run it — so this file's
 * current `up()` does NOT reflect what actually existed in prod
 * before 2026-07-28.
 *
 * Both columns were backfilled into production separately via
 * migration 0132
 * (20260728170000_0132_backfill_missing_columns_suppliers_shopopsettings.ts).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Use a new forward migration instead (rule 7).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('suppliers', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('name', 255).notNullable();
    table.string('contact_name', 255).nullable();
    table.string('contact_email', 255).nullable();
    table.string('contact_phone', 255).nullable();

    /**
     * COMPUTED RATING FIELDS
     * -----------------------
     * Updated by the PO receive flow — not manually set.
     * on_time_rate: % of POs received on or before expected_delivery_date
     * fill_rate: % of ordered units actually received
     * defect_rate: % of received units flagged as defective (fed from WMS pick exceptions)
     * total_pos: lifetime PO count for this supplier
     */
    table.decimal('on_time_rate', 5, 2).nullable();   // 0.00–100.00
    table.decimal('fill_rate', 5, 2).nullable();       // 0.00–100.00
    table.decimal('defect_rate', 5, 2).nullable();     // 0.00–100.00
    table.integer('total_pos').notNullable().defaultTo(0);

    table
      .decimal('avg_delivery_days', 6, 2)
      .nullable()
      .comment('Average actual vs expected delivery delta in days across all received POs. Negative = early, positive = late.');

    table.boolean('active').notNullable().defaultTo(true);
    table
      .integer('moq')
      .nullable()
      .comment('Minimum order quantity (units) this supplier accepts per PO. Null = no minimum. Supplier-level; reorder qty is rounded up to this before drafting a PO.');
    table
      .integer('lead_time_days')
      .nullable()
      .comment('Typical days from PO sent to goods received (produce + ship). Null = unknown. Supplier-level; used to compute reorder-by date = today + (days_of_stock - lead_time_days).');
    table.text('notes').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['shop_id', 'name'], 'suppliers_shop_name_unique');
    table.index(['shop_id']);
  });

  await knex.raw(`
    ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS suppliers_tenant_isolation_policy ON suppliers;
  `);

  await knex.raw(`
    CREATE POLICY suppliers_tenant_isolation_policy
    ON suppliers
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('suppliers');
}