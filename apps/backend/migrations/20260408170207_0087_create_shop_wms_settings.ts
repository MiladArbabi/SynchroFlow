import { Knex } from 'knex';

/**
 * MIGRATION 0087 — create_shop_wms_settings
 * -------------------------------------------
 * Per-shop WMS configuration.
 *
 * Drives:
 * - Auto-release worker (interval, enabled flag)
 * - Batch size ceiling at release time
 * - Idle operator alert threshold for pick and pack sessions
 *
 * One row per shop — upserted on first WMS activation.
 * All fields have safe defaults for SMB warehouses.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_wms_settings', (table) => {
    table
      .integer('shop_id')
      .primary()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    /**
     * Maximum number of line-items per batch.
     * Batch may release below this ceiling.
     * Default: 108 (SMB optimized).
     */
    table
      .integer('max_batch_line_items')
      .notNullable()
      .defaultTo(108);

    /**
     * Auto-release worker toggle.
     * When false, batches must be released manually.
     */
    table
      .boolean('auto_release_enabled')
      .notNullable()
      .defaultTo(true);

    /**
     * How often the auto-release worker checks the order pool.
     * Default: 30 minutes.
     */
    table
      .integer('auto_release_interval_minutes')
      .notNullable()
      .defaultTo(30);

    /**
     * Minutes of inactivity before an idle alert is fired
     * for pick or pack session operators.
     * Default: 20 minutes.
     */
    table
      .integer('idle_alert_threshold_minutes')
      .notNullable()
      .defaultTo(20);

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE shop_wms_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_wms_settings FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shop_wms_settings_tenant_isolation_policy ON shop_wms_settings;
  `);

  await knex.raw(`
    CREATE POLICY shop_wms_settings_tenant_isolation_policy
    ON shop_wms_settings
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_wms_settings');
}