import type { Knex } from 'knex';

/**
 * MIGRATION 0185 — Stow operator assignment.
 *
 * Historical stow_tasks predate explicit dispatch ownership, so assignment is
 * nullable at the schema level. New executable work is guarded at service/API
 * claim time.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('stow_tasks', (table) => {
    table.integer('assigned_operator_id').nullable();
    table.index(
      ['shop_id', 'assigned_operator_id'],
      'stow_tasks_shop_assigned_operator_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE stow_tasks
    ADD CONSTRAINT stow_tasks_assigned_operator_fk
    FOREIGN KEY (assigned_operator_id)
    REFERENCES users(id)
    ON DELETE SET NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE stow_tasks
    DROP CONSTRAINT IF EXISTS stow_tasks_assigned_operator_fk;
  `);

  await knex.schema.alterTable('stow_tasks', (table) => {
    table.dropIndex(
      ['shop_id', 'assigned_operator_id'],
      'stow_tasks_shop_assigned_operator_idx'
    );
    table.dropColumn('assigned_operator_id');
  });
}
