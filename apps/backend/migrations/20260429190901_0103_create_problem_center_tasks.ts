import { Knex } from 'knex';

/**
 * MIGRATION 0103 — create_problem_center_tasks
 * ----------------------------------------------
 * Physical warehouse exception tracking.
 * Created when operator reports exception in any workflow.
 *
 * Lifecycle: open → investigating → resolved | discarded | returned_to_supplier
 *
 * Links back to source exception (pick, stow, receive, pack).
 * Resolution writes inventory movement (shrinkage/damage) where applicable.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'problem_center_status'
      ) THEN
        CREATE TYPE problem_center_status AS ENUM (
          'open',
          'investigating',
          'resolved',
          'discarded',
          'returned_to_supplier'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'problem_center_source'
      ) THEN
        CREATE TYPE problem_center_source AS ENUM (
          'pick',
          'stow',
          'receive',
          'pack'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('problem_center_tasks', (table) => {
    table
      .uuid('problem_task_id')
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
      .specificType('status', 'problem_center_status')
      .notNullable()
      .defaultTo('open');

    table
      .specificType('source', 'problem_center_source')
      .notNullable();

    /**
     * EXCEPTION REFERENCE
     * -------------------
     * Links to the source exception record.
     * No FK — exception tables vary by source.
     */
    table.uuid('source_exception_id').nullable();

    /**
     * VARIANT + QUANTITY
     * ------------------
     * The physical item(s) that need intervention.
     */
    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    table.integer('quantity').notNullable().defaultTo(1);

    /**
     * EXCEPTION TYPE
     * --------------
     * Original exception type from source workflow.
     */
    table.string('exception_type', 100).notNullable();

    /**
     * PROBLEM BIN
     * -----------
     * Where the item is physically placed.
     * Copied from shop_wms_settings.problem_bin_location at creation time.
     */
    table.string('problem_bin_location', 255).nullable();

    /**
     * ASSIGNMENT
     * ----------
     * Nullable = pool (any operator can claim).
     * Set = assigned to specific operator.
     */
    table
      .integer('assigned_operator_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table
      .integer('claimed_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    /**
     * RESOLUTION
     * ----------
     * How the problem was resolved.
     * resolution_notes: free text for context.
     */
    table.string('resolution_action', 100).nullable();
    table.text('resolution_notes').nullable();
    table.integer('resolved_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('resolved_at', { useTz: true }).nullable();

    table.text('notes').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['lasyncro_variant_id']);
    table.index(['assigned_operator_id']);
    table.index(['claimed_by']);
  });

  await knex.raw(`ALTER TABLE problem_center_tasks ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE problem_center_tasks FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS problem_center_tasks_tenant_isolation ON problem_center_tasks;`);
  await knex.raw(`
    CREATE POLICY problem_center_tasks_tenant_isolation
    ON problem_center_tasks
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('problem_center_tasks');
  await knex.raw(`DROP TYPE IF EXISTS problem_center_status;`);
  await knex.raw(`DROP TYPE IF EXISTS problem_center_source;`);
}