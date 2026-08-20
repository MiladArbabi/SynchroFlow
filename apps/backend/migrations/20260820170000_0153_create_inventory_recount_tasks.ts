import type { Knex } from 'knex';

/**
 * MIGRATION 0153 — inventory recount tasks (INV-PHYSICAL-COUNT-13)
 * ----------------------------------------------------------------
 * Physical count capability. Until now laSyncro could state what it believed
 * (inventory_truth) and prove that belief from its ledger (INV-REBUILD-REPLAY-21),
 * but had no way to accept what a human actually saw on the shelf.
 *
 * TASK-FIRST, mirroring stow_tasks (0084): owner creates and assigns or
 * dispatches; one operator owns it via claimed_by; operator counts.
 *
 * DEFERRED CORRECTION (INV-PC-01): counting NEVER writes stock. Lines with a
 * non-zero variance go to manual_review; the owner accepts, orders a recount,
 * or escalates per line; commit writes reconciliation_correction movements.
 * A session with zero variance everywhere commits on operator close.
 *
 * BLIND BY DEFAULT: expected_quantity is snapshotted at line creation and must
 * not be sent to the operator client. Showing it makes operators confirm rather
 * than count — the largest source of false accuracy in any WMS.
 *
 * expected_quantity is a snapshot, not a live read: a sale mid-count would
 * otherwise shift the variance and the operator would be blamed for the
 * system's own movement.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recount_task_status') THEN
        CREATE TYPE recount_task_status AS ENUM (
          'draft', 'dispatched', 'claimed', 'counting',
          -- manual_review: house vocabulary (orders uses it for constraint_type).
          -- Distinct mechanism — must NOT feed queue_manual_review on the
          -- orders operational snapshot.
          'manual_review',
          'committed', 'cancelled'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recount_task_scope') THEN
        CREATE TYPE recount_task_scope AS ENUM (
          'full',        -- baseline count, expected once at adoption
          'location',    -- one bin or lane
          'variant_set', -- hand-picked SKUs
          'suggested'    -- system-selected from drift signals: root debt,
                         -- negative on_hand, stale stock, unstowed bins
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recount_method') THEN
        CREATE TYPE recount_method AS ENUM ('unit_scan', 'bin_quantity');
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recount_variance_reason') THEN
        CREATE TYPE recount_variance_reason AS ENUM (
          -- Parallel run: merchant still sells or moves stock outside laSyncro.
          -- Kept distinct so migration noise is not booked as shrinkage and
          -- does not poison demand forecasting.
          'unrecorded_external_workflow',
          'shrinkage', 'damage',
          'misplaced_stock',
          'count_error',
          'unknown'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    ALTER TYPE problem_center_source ADD VALUE IF NOT EXISTS 'count';
  `);

  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.integer('recount_label_sequence').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('inventory_recount_tasks', (table) => {
    table.uuid('recount_task_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');
    table.uuid('warehouse_id').notNullable()
      .references('warehouse_id').inTable('warehouses').onDelete('RESTRICT');
    table.string('label', 50).notNullable();
    table.specificType('scope', 'recount_task_scope').notNullable();
    table.specificType('status', 'recount_task_status').notNullable().defaultTo('draft');
    /**
     * Expected quantities are withheld from the operator client while true.
     * Server-side, not a UI concern.
     */
    table.boolean('blind').notNullable().defaultTo(true);
    /**
     * assigned_to null + status dispatched = open to all, first claim wins.
     * assigned_to set = only that operator may claim.
     */
    table.integer('assigned_to').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.integer('created_by').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    /** One operator owns the task at a time (stow_tasks:150 pattern). */
    table.integer('claimed_by').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.integer('reviewed_by').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('claimed_at', { useTz: true }).nullable();
    table.timestamp('counted_at', { useTz: true }).nullable();
    table.timestamp('committed_at', { useTz: true }).nullable();
    table.text('notes').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['shop_id', 'label']);
    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['assigned_to']);
    table.index(['claimed_by']);
  });

  await knex.schema.createTable('inventory_recount_lines', (table) => {
    table.uuid('recount_line_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('recount_task_id').notNullable()
      .references('recount_task_id').inTable('inventory_recount_tasks').onDelete('CASCADE');
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');
    table.uuid('lasyncro_variant_id').notNullable()
      .references('lasyncro_variant_id').inTable('variants').onDelete('RESTRICT');
    table.string('location_code', 255).notNullable();
    /** Snapshot at line creation — never re-read. See header. */
    table.integer('expected_quantity').notNullable();
    /** Null until the operator commits a count for this line. */
    table.integer('counted_quantity').nullable();
    table.integer('variance').nullable()
      .comment('counted_quantity - expected_quantity. Null until counted. Stored rather than generated so a committed line keeps its variance even if a later migration changes the formula.');
    table.specificType('count_method', 'recount_method').nullable();
    /** Units actually scanned when count_method = unit_scan. */
    table.integer('scan_count').nullable();
    table.specificType('variance_reason', 'recount_variance_reason').nullable();
    /**
     * Set when this line supersedes an earlier count of the same variant and
     * location. Preserves that the first count said 8 and the recount said 11,
     * rather than overwriting — most first-count variances are miscounts.
     */
    table.uuid('recount_of_line_id').nullable()
      .references('recount_line_id').inTable('inventory_recount_lines').onDelete('SET NULL');
    /** Written at commit. Movement is immutable once written (stow_tasks:160). */
    table.uuid('inventory_movement_id').nullable();
    table.integer('counted_by').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('counted_at', { useTz: true }).nullable();
    table.text('notes').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['shop_id']);
    table.index(['recount_task_id']);
    table.index(['lasyncro_variant_id']);
  });

  for (const t of ['inventory_recount_tasks', 'inventory_recount_lines']) {
    await knex.raw(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    await knex.raw(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
    await knex.raw(`DROP POLICY IF EXISTS ${t}_tenant_isolation_policy ON ${t};`);
    await knex.raw(`
      CREATE POLICY ${t}_tenant_isolation_policy
      ON ${t}
      USING (shop_id = current_setting('app.current_tenant')::int);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inventory_recount_lines');
  await knex.schema.dropTableIfExists('inventory_recount_tasks');
  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.dropColumn('recount_label_sequence');
  });
  await knex.raw(`DROP TYPE IF EXISTS recount_variance_reason;`);
  await knex.raw(`DROP TYPE IF EXISTS recount_method;`);
  await knex.raw(`DROP TYPE IF EXISTS recount_task_scope;`);
  await knex.raw(`DROP TYPE IF EXISTS recount_task_status;`);
  /**
   * problem_center_source 'count' is NOT removed: PostgreSQL cannot drop an
   * enum value, and rows may reference it.
   */
}
