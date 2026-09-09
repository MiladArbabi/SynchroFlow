import type { Knex } from 'knex';

/**
 * MIGRATION 0169 — pick_exception_event_identity
 * ------------------------------------------------
 * GH-1049 Pick exception core.
 *
 * A. DURABLE PICK EXCEPTION EVENT IDENTITY
 *    pick_exceptions.device_event_id carries the operator device's stable
 *    event id so an exact replay resolves to the SAME exception instead of
 *    creating a second incident. Uniqueness is tenant-scoped and partial so
 *    every historical row (device_event_id IS NULL) stays valid.
 *
 * B. ONE PROBLEM TASK PER PICK EXCEPTION
 *    problem_center_tasks.source_pick_exception_id is a real FK to the
 *    pick_exceptions row that caused the task, with a partial unique index.
 *
 *    A unique index on (shop_id, source, source_exception_id) WHERE
 *    source_exception_id IS NOT NULL was audited and REJECTED:
 *    cancellationUnwind.service.ts writes source='pick' rows whose
 *    source_exception_id is a lasyncro_order_id, one row per variant of the
 *    cancelled order, so that key is legitimately non-unique today. The
 *    returns writers (returnJobs.service.ts) likewise write two source
 *    'returns' rows against one return_job_id. A dedicated FK column
 *    constrains exactly the new Pick-exception relationship and leaves every
 *    existing source semantic untouched.
 *
 *    source_exception_id is still populated with the pick_exception_id by the
 *    Pick path, so existing Problem Center readers are unchanged.
 *
 * Does not alter migrations 0083, 0103 or 0143.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pick_exceptions', (table) => {
    table.uuid('device_event_id').nullable();
  });

  await knex.raw(`
    CREATE UNIQUE INDEX
      pick_exceptions_device_event_unique
    ON pick_exceptions (shop_id, device_event_id)
    WHERE device_event_id IS NOT NULL;
  `);

  await knex.schema.alterTable('problem_center_tasks', (table) => {
    table
      .uuid('source_pick_exception_id')
      .nullable()
      .references('pick_exception_id')
      .inTable('pick_exceptions')
      .onDelete('CASCADE');
  });

  await knex.raw(`
    CREATE UNIQUE INDEX
      problem_center_tasks_pick_exception_unique
    ON problem_center_tasks (shop_id, source_pick_exception_id)
    WHERE source_pick_exception_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS
      problem_center_tasks_pick_exception_unique;
  `);

  await knex.schema.alterTable('problem_center_tasks', (table) => {
    table.dropColumn('source_pick_exception_id');
  });

  await knex.raw(`
    DROP INDEX IF EXISTS
      pick_exceptions_device_event_unique;
  `);

  await knex.schema.alterTable('pick_exceptions', (table) => {
    table.dropColumn('device_event_id');
  });
}
