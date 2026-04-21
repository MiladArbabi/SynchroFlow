import { Knex } from 'knex';

/**
 * MIGRATION 0099 — create_receive_exceptions
 * --------------------------------------------
 * Logs per-unit problems raised during the inspection stage of a receive job.
 *
 * Exception types:
 * - defect             — unit physically damaged / unusable
 * - packaging_damage   — packaging damaged, unit sellable
 * - wrong_item         — completely wrong product received
 * - wrong_variant      — correct product, wrong variant (size/colour)
 * - wrong_quantity     — shipment count doesn't match PO
 * - barcode_mismatch   — unit barcode doesn't match variant in system (ISSUE-011)
 * - other              — catch-all; requires notes
 *
 * Feeds defect_rate recompute on receive job close (ISSUE-005).
 * Resolved by owner/admin — not operator.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'receive_exception_type'
      ) THEN
        CREATE TYPE receive_exception_type AS ENUM (
          'defect',
          'packaging_damage',
          'wrong_item',
          'wrong_variant',
          'wrong_quantity',
          'barcode_mismatch',
          'other'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('receive_exceptions', (table) => {
    table
      .uuid('receive_exception_id')
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

    table
      .uuid('receive_job_line_id')
      .notNullable()
      .references('receive_job_line_id')
      .inTable('receive_job_lines')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    table
      .specificType('exception_type', 'receive_exception_type')
      .notNullable();

    table.integer('quantity_affected').notNullable().defaultTo(1);

    /**
     * Required for barcode_mismatch — captures what was actually scanned.
     * Required for other — captures free-form description.
     */
    table.text('notes').nullable();

    table
      .integer('raised_by')
      .nullable() // Nullable: operator account may be removed (SET NULL on delete)
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('raised_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

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
    table.index(['receive_job_id']);
    table.index(['lasyncro_variant_id']);
    table.index(['shop_id', 'resolved']); // defect_rate recompute query
  });

  await knex.raw(`ALTER TABLE receive_exceptions ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE receive_exceptions FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS receive_exceptions_tenant_isolation_policy ON receive_exceptions;`);
  await knex.raw(`
    CREATE POLICY receive_exceptions_tenant_isolation_policy
    ON receive_exceptions
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('receive_exceptions');
  await knex.raw(`DROP TYPE IF EXISTS receive_exception_type;`);
}