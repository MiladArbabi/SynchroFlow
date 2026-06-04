// apps/backend/migrations/20260513143901_0106_create_printers.ts
import { Knex } from 'knex';

/**
 * MIGRATION 0106 — create_printers
 * ---------------------------------
 * Registers physical label printers available in a shop's warehouse.
 *
 * Printers are shop-scoped, not operator-scoped.
 * An operator selects which printer they're standing next to
 * at the start of a receive session — the printer belongs to
 * the shop's physical space.
 *
 * Used by:
 * - barcode_print_jobs.printer_id → routes print job to correct device
 * - Mobile receive flow → operator selects active printer at session start
 *
 * Supported connection types:
 * - bluetooth: direct mobile→printer (Zebra ZQ series, Brother RJ series)
 * - wifi:      network-addressed printer (Zebra ZT series, Brother QL series)
 * - usb:       desktop-connected (fallback, rare in warehouse context)
 *
 * Invariants:
 * - One default printer per shop (enforced at application layer)
 * - inactive printers are hidden from operator selection but preserved for audit
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'printer_connection_type'
      ) THEN
        CREATE TYPE printer_connection_type AS ENUM (
          'bluetooth',
          'wifi',
          'usb'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'printer_role'
      ) THEN
        CREATE TYPE printer_role AS ENUM (
          'unit_label',
          'invoice',
          'problem_label',
          'general'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('printers', (table) => {
    table
      .uuid('printer_id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    /**
     * DISPLAY NAME
     * ------------
     * Human-readable name for operator selection.
     * e.g. "Receiving Dock Printer", "Zone A Zebra"
     */
    table.string('name', 255).notNullable();

    /**
     * CONNECTION
     * ----------
     * bluetooth: mobile pairs directly — address = BT MAC address
     * wifi:      network printer — address = IP address or hostname
     * usb:       desktop connected — address = null (local only)
     */
    table
      .specificType('connection_type', 'printer_connection_type')
      .notNullable();

    /**
     * ADDRESS
     * -------
     * BT MAC (e.g. "00:07:4D:4A:3B:2C") or IP (e.g. "192.168.1.45").
     * Null for USB printers.
     */
    table.string('address', 255).nullable();

    /**
     * MODEL
     * -----
     * Free text — used to select correct print driver/template on mobile.
     * e.g. "Zebra ZQ520", "Brother RJ-3250WB"
     */
    table.string('model', 255).nullable();

    /**
     * ROLE
     * ----
     * Determines which print jobs are routed to this printer.
     * unit_label:    LSU- thermal labels generated at receive (WM-46/47)
     * invoice:       A4 invoice PDFs generated at pack (WM-34)
     * problem_label: PROB-BIN labels for problem center tasks
     * general:       fallback for any unrouted job
     * One default printer per role per shop — enforced at application layer.
     */
    table
      .specificType('role', 'printer_role')
      .notNullable()
      .defaultTo('general');

    /**
     * OS PRINTER NAME
     * ---------------
     * Exact OS-registered name as returned by QZ Tray printer detection.
     * Used by QZ Tray to route jobs to the correct physical device.
     * e.g. "Zebra ZD421", "Brother QL-820NWB"
     * Null for printers registered via direct IP (wifi/BT path).
     */
    table.string('os_printer_name', 255).nullable();

    /**
     * DEFAULT PRINTER
     * ---------------
     * If true, pre-selected for new receive sessions.
     * Only one default per shop — enforced at application layer.
     */
    table.boolean('is_default').notNullable().defaultTo(false);

    /**
     * ACTIVE
     * ------
     * Inactive printers hidden from operator selection.
     * Never delete — preserves print job audit trail.
     */
    table.boolean('active').notNullable().defaultTo(true);

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'active']); // operator printer selection query
  });

  // RLS — printers are strictly tenant-scoped
  await knex.raw(`ALTER TABLE printers ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE printers FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS printers_tenant_isolation_policy ON printers;`);
  await knex.raw(`
    CREATE POLICY printers_tenant_isolation_policy
    ON printers
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
 await knex.schema.dropTableIfExists('printers');
  await knex.raw(`DROP TYPE IF EXISTS printer_role;`);
  await knex.raw(`DROP TYPE IF EXISTS printer_connection_type;`);
}