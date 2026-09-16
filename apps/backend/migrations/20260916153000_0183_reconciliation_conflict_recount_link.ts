import type { Knex } from 'knex';

/**
 * MIGRATION 0183 — reconciliation conflict → targeted recount lineage
 *
 * A reconciliation conflict is the parent incident.
 * A targeted blind recount is evidence-gathering work underneath it.
 *
 * The link is durable so we never correlate the two workflows through
 * labels, notes, or inference.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(
    'inventory_reconciliation_conflicts',
    (table) => {
      table.uuid('recount_task_id').nullable();
      table
        .timestamp('recount_requested_at', { useTz: true })
        .nullable();
      table.integer('recount_requested_by').nullable();

      table.index(
        ['shop_id', 'recount_task_id'],
        'inventory_reconciliation_conflicts_recount_idx'
      );
    }
  );

  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    ADD CONSTRAINT
      inventory_reconciliation_conflicts_recount_task_fk
    FOREIGN KEY (recount_task_id)
    REFERENCES inventory_recount_tasks(recount_task_id)
    ON DELETE RESTRICT;
  `);

  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    ADD CONSTRAINT
      inventory_reconciliation_conflicts_recount_requested_by_fk
    FOREIGN KEY (recount_requested_by)
    REFERENCES users(id)
    ON DELETE SET NULL;
  `);

  /**
   * No half-linked verification work:
   *
   * - no recount => no recount request metadata
   * - linked recount => request timestamp is mandatory
   *
   * requested_by remains nullable because user lifecycle must not destroy
   * historical reconciliation lineage.
   */
  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    ADD CONSTRAINT
      inventory_reconciliation_conflicts_recount_link_chk
    CHECK (
      (
        recount_task_id IS NULL
        AND recount_requested_at IS NULL
        AND recount_requested_by IS NULL
      )
      OR
      (
        recount_task_id IS NOT NULL
        AND recount_requested_at IS NOT NULL
      )
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    DROP CONSTRAINT IF EXISTS
      inventory_reconciliation_conflicts_recount_link_chk;
  `);

  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    DROP CONSTRAINT IF EXISTS
      inventory_reconciliation_conflicts_recount_requested_by_fk;
  `);

  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    DROP CONSTRAINT IF EXISTS
      inventory_reconciliation_conflicts_recount_task_fk;
  `);

  await knex.schema.alterTable(
    'inventory_reconciliation_conflicts',
    (table) => {
      table.dropIndex(
        ['shop_id', 'recount_task_id'],
        'inventory_reconciliation_conflicts_recount_idx'
      );
      table.dropColumn('recount_requested_by');
      table.dropColumn('recount_requested_at');
      table.dropColumn('recount_task_id');
    }
  );
}
