import { Knex } from 'knex';

/**
 * MIGRATION 0083 — create_pick_exceptions
 * ----------------------------------------
 * Persistent ledger for all exception signals raised during
 * pick and pack operations.
 *
 * Feeds the SKU Gaps module for manual resolution by supervisors.
 *
 * Exception types:
 * - item_missing       — item not found at location
 * - short_pick         — fewer units found than required
 * - product_defect     — item found but damaged/unusable
 * - packaging_defect   — packaging damaged but item sellable
 * - order_cancelled    — order cancelled mid-pick; stow task auto-generated
 * - wrong_item         — wrong product found at location (should not occur if barcode gate enforced)
 *
 * Resolution:
 * - resolved_by / resolved_at set when supervisor closes the exception
 * - resolution_note captures corrective action taken
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'pick_exception_type'
      ) THEN
        CREATE TYPE pick_exception_type AS ENUM (
          'item_missing',
          'short_pick',
          'product_defect',
          'packaging_defect',
          'order_cancelled',
          'wrong_item'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'pick_exception_stage'
      ) THEN
        CREATE TYPE pick_exception_stage AS ENUM (
          'pick',
          'pack'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('pick_exceptions', (table) => {
    table
      .uuid('pick_exception_id')
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
      .uuid('lasyncro_line_item_id')
      .notNullable()
      .references('lasyncro_line_item_id')
      .inTable('order_line_items')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable();

    table
      .specificType('exception_type', 'pick_exception_type')
      .notNullable();

    /**
     * Stage at which exception was raised: pick or pack.
     * Determines which operator / session is responsible.
     */
    table
      .specificType('stage', 'pick_exception_stage')
      .notNullable();

    /**
     * QUANTITY CONTEXT
     * ----------------
     * quantity_required — units expected per line item
     * quantity_found    — units actually found (0 for item_missing, <required for short_pick)
     */
    table.integer('quantity_required').notNullable();
    table.integer('quantity_found').notNullable().defaultTo(0);

    /**
     * Operator who raised the exception.
     * Nullable on delete — operator account may be removed.
     */
    table
      .integer('raised_by')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('raised_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * RESOLUTION
     * ----------
     * resolved = false until supervisor closes via SKU Gaps module.
     */
    table.boolean('resolved').notNullable().defaultTo(false);

    table
      .integer('resolved_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('resolved_at', { useTz: true }).nullable();
    table.text('resolution_note').nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['pick_batch_id']);
    table.index(['shop_id', 'resolved']); // SKU Gaps module query
    table.index(['lasyncro_variant_id']);
  });

  await knex.raw(`
    ALTER TABLE pick_exceptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pick_exceptions FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS pick_exceptions_tenant_isolation_policy ON pick_exceptions;
  `);

  await knex.raw(`
    CREATE POLICY pick_exceptions_tenant_isolation_policy
    ON pick_exceptions
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pick_exceptions');
  await knex.raw(`DROP TYPE IF EXISTS pick_exception_type;`);
  await knex.raw(`DROP TYPE IF EXISTS pick_exception_stage;`);
}