import type { Knex } from 'knex';

/**
 * MIGRATION 0184 — Stow tasks retain exact Receive-line lineage.
 *
 * Inbound stow is a physical handoff from one receive_job_lines row to one
 * stow_tasks row. Historical and non-inbound tasks may not have that lineage,
 * so the column remains nullable.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('stow_tasks', (table) => {
    table.uuid('receive_job_line_id').nullable();
    table.index(
      ['shop_id', 'receive_job_line_id'],
      'stow_tasks_shop_receive_job_line_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE stow_tasks
    ADD CONSTRAINT stow_tasks_receive_job_line_fk
    FOREIGN KEY (receive_job_line_id)
    REFERENCES receive_job_lines(receive_job_line_id)
    ON DELETE RESTRICT;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE stow_tasks
    DROP CONSTRAINT IF EXISTS stow_tasks_receive_job_line_fk;
  `);

  await knex.schema.alterTable('stow_tasks', (table) => {
    table.dropIndex(
      ['shop_id', 'receive_job_line_id'],
      'stow_tasks_shop_receive_job_line_idx'
    );
    table.dropColumn('receive_job_line_id');
  });
}
