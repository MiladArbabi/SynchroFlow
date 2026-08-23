import type { Knex } from 'knex';

/**
 * MIGRATION 0160 — recount physical findings (RECOUNT-EXCEPTIONS-80)
 * ------------------------------------------------------------------
 * Recount lines answer one question only: how many units did the operator
 * physically observe for an expected variant/location pair?
 *
 * They cannot represent a variant physically found where no recount line
 * exists, nor a defect observed on stock that is still physically present.
 *
 * Findings therefore remain separate from quantity truth:
 * - unexpected_item   — valid variant physically found in this location
 * - product_defect    — item is physically present but defective
 * - packaging_defect  — item is physically present but packaging is defective
 *
 * Recording a finding NEVER mutates inventory_truth or creates a reconciliation
 * movement. Inventory correction remains downstream of review/commit.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTasks = await knex.schema.hasTable('inventory_recount_tasks');
  const hasLines = await knex.schema.hasTable('inventory_recount_lines');

  if (!hasTasks || !hasLines) {
    throw new Error(
      '[0160] recount base tables missing — migration 0153 must run first'
    );
  }

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'recount_finding_type'
      ) THEN
        CREATE TYPE recount_finding_type AS ENUM (
          'unexpected_item',
          'product_defect',
          'packaging_defect'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('inventory_recount_findings', (table) => {
    table.uuid('recount_finding_id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('recount_task_id')
      .notNullable()
      .references('recount_task_id')
      .inTable('inventory_recount_tasks')
      .onDelete('CASCADE');

    /**
     * Nullable because unexpected stock has no expected recount line.
     * Defect findings on an expected item may point back to its recount line.
     */
    table.uuid('recount_line_id')
      .nullable()
      .references('recount_line_id')
      .inTable('inventory_recount_lines')
      .onDelete('SET NULL');

    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    table.string('location_code', 255).notNullable();

    table.specificType('finding_type', 'recount_finding_type').notNullable();

    table.integer('quantity').notNullable();

    table.text('notes').nullable();

    table.integer('reported_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('reported_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['recount_task_id']);
    table.index(['recount_line_id']);
    table.index(['lasyncro_variant_id']);
    table.index(['shop_id', 'finding_type']);
  });

  await knex.raw(`
    ALTER TABLE inventory_recount_findings
    ADD CONSTRAINT inventory_recount_findings_quantity_positive
    CHECK (quantity > 0);
  `);

  await knex.raw(`
    ALTER TABLE inventory_recount_findings ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    ALTER TABLE inventory_recount_findings FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS
      inventory_recount_findings_tenant_isolation_policy
    ON inventory_recount_findings;
  `);

  await knex.raw(`
    CREATE POLICY inventory_recount_findings_tenant_isolation_policy
    ON inventory_recount_findings
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inventory_recount_findings');
  await knex.raw(`DROP TYPE IF EXISTS recount_finding_type;`);
}
