import { Knex } from 'knex';

/**
 * MIGRATION 0100 — create_barcode_print_jobs
 * --------------------------------------------
 * Tracks barcode label print jobs generated during receive sessions (WM-27).
 *
 * Created when:
 * - Variant has no barcode → system generates LS-{shopId}-{variantIdShort} and queues print
 * - Variant barcode corrected via PATCH /floor-planning/products/:id/barcode → reprint queued
 *
 * Lifecycle: pending → printing → printed → attached
 * - attached: operator physically affixes label to units — confirmed manually or on stow scan
 *
 * Invariants:
 * - One print job per (receive_job_id, lasyncro_variant_id) — enforced via unique index
 * - barcode_value is the authoritative value printed — snapshot at job creation time
 * - receive_job_id nullable: print jobs can be created outside receive flow (reprint)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'barcode_print_job_status'
      ) THEN
        CREATE TYPE barcode_print_job_status AS ENUM (
          'pending',
          'printing',
          'printed',
          'attached'
        );
      END IF;
    END$$;
  `);

  // label_type: determines which physical label template is printed.
  // 'lasyncro' → standard variant identity label (SKU + barcode + product name)
  // 'problem'  → PROBLEM-BIN label (variant + exception type + problem task ID)
  //              attached to problematic units before dropping in PROBLEM-BIN
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'barcode_label_type'
      ) THEN
        CREATE TYPE barcode_label_type AS ENUM (
          'lasyncro',
          'problem'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('barcode_print_jobs', (table) => {
    table
      .uuid('print_job_id')
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
     * Nullable — print jobs created outside a receive session (reprint flow).
     * No FK to receive_jobs — receive_jobs created after this migration would
     * require a patch migration. Application layer enforces the relationship.
     */
    table
      .uuid('receive_job_id')
      .nullable();

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    table.integer('quantity').notNullable();

    /**
     * Snapshot of the barcode value at print time.
     * Decoupled from external_product_identity_map — if barcode is corrected
     * after printing, this preserves what was actually printed.
     */
    table.string('barcode_value', 255).notNullable();

    /**
     * LABEL TYPE
     * ----------
     * Determines print template:
     * - lasyncro: standard variant identity label — printed on receive confirm
     * - problem:  PROBLEM-BIN label — printed when unit flagged as problematic
     *             operator attaches and drops unit in PROBLEM-BIN
     */
    table
      .specificType('label_type', 'barcode_label_type')
      .notNullable()
      .defaultTo('lasyncro');

    /**
     * PRINTER ASSIGNMENT
     * ------------------
     * Which registered shop printer to send this job to.
     * Nullable — operator selects printer at receive session start.
     * No FK — printers table created in migration 0106.
     * Application layer enforces existence.
     */
    table.uuid('printer_id').nullable();
    table.index(['printer_id']); // fast queue poll per printer

    table
      .specificType('status', 'barcode_print_job_status')
      .notNullable()
      .defaultTo('pending');

    /**
     * Operator who triggered the print job.
     * Nullable on delete — operator account may be removed.
     */
    table
      .integer('created_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('printed_at', { useTz: true }).nullable();
    table.timestamp('attached_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // One active print job per variant per receive session
    table.unique(
      ['shop_id', 'receive_job_id', 'lasyncro_variant_id'],
      'barcode_print_jobs_unique'
    );

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['lasyncro_variant_id']);
    table.index(['receive_job_id']);
  });

  await knex.raw(`ALTER TABLE barcode_print_jobs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE barcode_print_jobs FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS barcode_print_jobs_tenant_isolation_policy ON barcode_print_jobs;`);
  await knex.raw(`
    CREATE POLICY barcode_print_jobs_tenant_isolation_policy
    ON barcode_print_jobs
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('barcode_print_jobs');
  await knex.raw(`DROP TYPE IF EXISTS barcode_label_type;`);
  await knex.raw(`DROP TYPE IF EXISTS barcode_print_job_status;`);
}