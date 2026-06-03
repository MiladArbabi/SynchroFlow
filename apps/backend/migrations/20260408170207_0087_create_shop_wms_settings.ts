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
      .defaultTo(false);

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

    /**
     * PROBLEM BIN LOCATION
     * --------------------
     * Configurable per shop — where operators physically place
     * flagged/excepted items for owner review and resolution.
     * Defaults to WH-{shopId}-PROBLEM if not configured.
     */
    table.string('problem_bin_location', 255)
      .nullable();

    /**
     * PROB LABEL SEQUENCE
     * -------------------
     * Auto-incrementing counter for PROB-{shopId}-{seq} labels.
     * Incremented atomically on each problem center task creation.
     */
    table.integer('prob_label_sequence')
      .notNullable()
      .defaultTo(0);

    /**
     * RETURN LABEL TOGGLE (WM-38)
     * ---------------------------
     * When true, a carrier return slip is composited onto the bottom
     * half of the WM-34 A4 invoice PDF at pack time.
     * Only meaningful when a carrier is configured in shop_carrier_settings.
     * Shop owner configures via Settings > Warehouse.
     */
    table.boolean('include_return_label')
      .notNullable()
      .defaultTo(false);

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

  await knex.schema.createTable('shop_display_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');
    /**
     * token_hash: bcrypt/argon2 hash — raw token shown once at creation only.
     * label: human label for the display ("Warehouse main", "Pick station 1 TV").
     * rotated_at: set on rotation — old token immediately invalid on next 5-min refresh.
     * last_seen_at: updated by heartbeat — drives active-displays counter (within 60s).
     */
    table.text('token_hash').notNullable();
    table.text('label').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('rotated_at', { useTz: true }).nullable();
    table.timestamp('last_seen_at', { useTz: true }).nullable();
    table.index(['shop_id']);
  });

  await knex.raw(`
    ALTER TABLE shop_display_tokens ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_display_tokens FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shop_display_tokens_tenant_isolation_policy ON shop_display_tokens;
  `);

  await knex.raw(`
    CREATE POLICY shop_display_tokens_tenant_isolation_policy
    ON shop_display_tokens
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_display_tokens');
  await knex.schema.dropTableIfExists('shop_wms_settings');
}