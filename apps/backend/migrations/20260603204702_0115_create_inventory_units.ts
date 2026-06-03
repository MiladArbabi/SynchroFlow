import { Knex } from 'knex';

/**
 * MIGRATION 0115 — create_inventory_units
 * ----------------------------------------
 * Per-unit identity table — the backbone of WM-46 per-unit barcode system.
 *
 * Every physical unit that enters the warehouse gets one row here,
 * assigned at receive batch-confirm. The LSU- identifier is immutable
 * for the lifetime of the unit, including returns.
 *
 * LSU- identifier generation (deterministic hash):
 *   SHA256(shop_id + receive_job_line_id + receive_sequence)[0:8]
 *   Prefix: LSU-{8 hex chars}
 *   receive_job_line_id is always non-null (uniquely identifies session × variant)
 *   and serves as the anchor for both PO and no-PO receives.
 *
 * Barcode namespace reservation:
 *   LSU- → unit barcodes (this table)
 *   LSO- → order invoice barcodes (WM-34, orders.wms_barcode)
 *   Legacy EAN/UPC → external_product_identity_map (fallback while progressive
 *                    labelling coverage < coverage_sunset_threshold)
 *
 * Enum naming:
 *   inventory_unit_lifecycle_status — avoids collision with inventory_unit_status
 *     TABLE created in migration 0088 (PostgreSQL auto-creates a composite type
 *     with the same name as every table, which would shadow an enum of the same name).
 *   inventory_unit_provenance — source of unit creation.
 *
 * Location reference:
 *   current_location_code is a plain string (no FK) — warehouse_locations PK is
 *   composite (shop_id, location_code); all other WMS tables follow the same pattern.
 *
 * Invariants (must never be violated):
 *   1. lasyncro_unit_id is written once and never updated.
 *   2. receive_sequence is written once and never updated.
 *   3. Returned units reclaim their original row — no new row created.
 *   4. reprint_count is incremented on every reprint, never decremented.
 *
 * See: docs/blueprints/unit_barcode_architecture.md
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'inventory_unit_lifecycle_status'
      ) THEN
        CREATE TYPE inventory_unit_lifecycle_status AS ENUM (
          'received',
          'stowed',
          'picked',
          'packed',
          'shipped',
          'returned',
          'lost'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'inventory_unit_provenance'
      ) THEN
        CREATE TYPE inventory_unit_provenance AS ENUM (
          'lasyncro_receive',
          'legacy_stocktake',
          'manual_entry'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('inventory_units', (table) => {
    table
      .uuid('id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    /**
     * LSU-{8 hex chars} — deterministic, immutable, globally unique per shop.
     * Generated at batch-confirm during receive. Never regenerated — only reprinted.
     */
    table
      .string('lasyncro_unit_id', 20)
      .notNullable()
      .unique();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    /**
     * RECEIVE ANCHORS — immutable after creation.
     * receive_job_line_id: uniquely identifies (session × variant).
     *   Works for both PO and no-PO receives — always non-null.
     * receive_sequence: position of this unit within its receive_job_line (1-based).
     *   Assigned in bulk at batch-confirm. Immutable.
     */
    table
      .uuid('receive_job_line_id')
      .notNullable()
      .references('receive_job_line_id')
      .inTable('receive_job_lines')
      .onDelete('RESTRICT');

    table
      .integer('receive_sequence')
      .notNullable();

    /**
     * EXTERNAL BARCODE COUPLING (Class A products — nullable for Class B)
     * Stored at receive for reprint disambiguation: operator scans EAN/UPC
     * → system finds units with that code → narrows by location → reprints.
     */
    table.string('ean', 100).nullable();
    table.string('upc', 100).nullable();
    table.string('shopify_barcode', 255).nullable();

    /**
     * PROVENANCE
     * lasyncro_receive: created via normal receive workflow (default)
     * legacy_stocktake: created via optional targeted stocktake flow
     * manual_entry:     created by owner/admin outside normal flows
     */
    table
      .specificType('source', 'inventory_unit_provenance')
      .notNullable()
      .defaultTo('lasyncro_receive');

    /**
     * LABEL STATE
     * reprint_count > 0 signals label was replaced — audit signal.
     * High reprint_count warrants investigation.
     */
    table.timestamp('label_printed_at', { useTz: true }).nullable();
    table.timestamp('label_last_reprinted_at', { useTz: true }).nullable();
    table.integer('reprint_count').notNullable().defaultTo(0);

    /**
     * LIFECYCLE STATUS
     * Mirrors warehouse pipeline stages.
     * Named inventory_unit_lifecycle_status to avoid shadowing the
     * inventory_unit_status TABLE composite type (migration 0088).
     */
    table
      .specificType('status', 'inventory_unit_lifecycle_status')
      .notNullable()
      .defaultTo('received');

    /**
     * CURRENT LOCATION
     * Plain string — no FK. warehouse_locations PK is composite (shop_id, location_code).
     * Pattern consistent with stow_tasks, pick_scan_log, and all other WMS tables.
     */
    table
      .string('current_location_code', 255)
      .nullable();

    table.timestamp('received_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * Composite unique: one row per unit position within a receive line.
     * Prevents duplicate sequence assignment at batch-confirm.
     */
    table.unique(
      ['shop_id', 'receive_job_line_id', 'receive_sequence'],
      'inventory_units_receive_unique'
    );

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['lasyncro_variant_id']);
    table.index(['receive_job_line_id']);
    table.index(['current_location_code']);
  });

  await knex.raw(`ALTER TABLE inventory_units ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE inventory_units FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS inventory_units_tenant_isolation_policy ON inventory_units;`);
  await knex.raw(`
    CREATE POLICY inventory_units_tenant_isolation_policy
    ON inventory_units
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inventory_units');
  await knex.raw(`DROP TYPE IF EXISTS inventory_unit_provenance;`);
  await knex.raw(`DROP TYPE IF EXISTS inventory_unit_lifecycle_status;`);
}