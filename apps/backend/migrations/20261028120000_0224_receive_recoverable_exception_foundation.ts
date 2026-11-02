import type { Knex } from 'knex';

/** S8-C5 / S4-1 — schema foundation for recoverable Receive exceptions
 * (contract SF-RECEIVE-S8C5-S4-CONTRACT-026, K1–K7 ratified).
 *
 * Additive only. Nothing here enables recovery: the runtime held-quantity
 * rejection (receiveJob.service inspect) and the Receive-close held guard stay
 * in force, so no row can yet carry a held quantity, a held unit or a Receive
 * unit task. Later slices (S4-2…S4-5) start using these objects.
 *
 *   receive_job_lines   quantity_held_recoverable may be >= 0; the 0208
 *                       delivered = accepted + rejected + held identity is
 *                       unchanged.
 *   receive_exceptions  disposition (NULL = legacy). recoverable_held is
 *                       explicit, limited to defect / packaging_damage and
 *                       never shortfall accounting. Immutable after insert
 *                       for sf_app through the 0223 evidence guard.
 *   inventory_units     statuses held / discarded; held_placed_at custody.
 *   problem_center_tasks lasyncro_unit_id; one Receive task per unit per shop.
 *   stow_tasks          trigger receive_recovery.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_delivery_disposition_valid;
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_delivery_disposition_valid CHECK (
      (quantity_delivered IS NULL OR quantity_delivered >= 0)
      AND (quantity_missing IS NULL OR quantity_missing >= 0)
      AND (quantity_deferred IS NULL OR quantity_deferred >= 0)
      AND (quantity_held_recoverable IS NULL OR quantity_held_recoverable >= 0)
      AND (quantity_delivered IS NULL OR (
        inspection_complete AND quantity_missing IS NOT NULL AND quantity_deferred IS NOT NULL
        AND quantity_held_recoverable IS NOT NULL AND quantity_accepted >= 0 AND quantity_rejected >= 0
        AND quantity_delivered = quantity_accepted + quantity_rejected + quantity_held_recoverable
        AND quantity_delivered + quantity_missing + quantity_deferred >= quantity_expected
      ))
    );

    CREATE TYPE receive_exception_disposition AS ENUM ('non_recoverable', 'recoverable_held');
    ALTER TABLE receive_exceptions ADD COLUMN disposition receive_exception_disposition NULL;
    ALTER TABLE receive_exceptions ADD CONSTRAINT receive_exceptions_disposition_valid CHECK (
      disposition IS DISTINCT FROM 'recoverable_held'
      OR (
        exception_type IN ('defect', 'packaging_damage')
        AND accounting_role IS NULL
        AND counts_toward_shortfall = false
      )
    );

    ALTER TYPE inventory_unit_lifecycle_status ADD VALUE IF NOT EXISTS 'held';
    ALTER TYPE inventory_unit_lifecycle_status ADD VALUE IF NOT EXISTS 'discarded';
    ALTER TABLE inventory_units ADD COLUMN held_placed_at timestamptz NULL;

    ALTER TABLE problem_center_tasks ADD COLUMN lasyncro_unit_id varchar(20) NULL;
    CREATE UNIQUE INDEX problem_center_receive_unit_unique
      ON problem_center_tasks (shop_id, lasyncro_unit_id)
      WHERE source = 'receive' AND lasyncro_unit_id IS NOT NULL;

    ALTER TYPE stow_task_trigger ADD VALUE IF NOT EXISTS 'receive_recovery';
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0208/0223: persisted recovery
  // evidence wins over rollback convenience.
  await knex.raw(`
    LOCK TABLE receive_job_lines, receive_exceptions, inventory_units, problem_center_tasks, stow_tasks
      IN ACCESS EXCLUSIVE MODE
  `);
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM receive_job_lines WHERE quantity_held_recoverable > 0)
      OR EXISTS (SELECT 1 FROM receive_exceptions WHERE disposition IS NOT NULL)
      OR EXISTS (SELECT 1 FROM inventory_units
                  WHERE status::text IN ('held', 'discarded') OR held_placed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM problem_center_tasks WHERE lasyncro_unit_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM stow_tasks WHERE trigger::text = 'receive_recovery')
    ) AS has_evidence
  `);

  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_RECOVERY_ROLLBACK_BLOCKED] persisted recoverable Receive evidence exists; 0224 cannot be removed'
    );
  }

  await knex.raw(`
    DROP INDEX problem_center_receive_unit_unique;
    ALTER TABLE problem_center_tasks DROP COLUMN lasyncro_unit_id;
    ALTER TABLE inventory_units DROP COLUMN held_placed_at;
    ALTER TABLE receive_exceptions DROP CONSTRAINT receive_exceptions_disposition_valid;
    ALTER TABLE receive_exceptions DROP COLUMN disposition;
    DROP TYPE receive_exception_disposition;
    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_delivery_disposition_valid;
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_delivery_disposition_valid CHECK (
      (quantity_delivered IS NULL OR quantity_delivered >= 0)
      AND (quantity_missing IS NULL OR quantity_missing >= 0)
      AND (quantity_deferred IS NULL OR quantity_deferred >= 0)
      AND (quantity_held_recoverable IS NULL OR quantity_held_recoverable = 0)
      AND (quantity_delivered IS NULL OR (
        inspection_complete AND quantity_missing IS NOT NULL AND quantity_deferred IS NOT NULL
        AND quantity_held_recoverable IS NOT NULL AND quantity_accepted >= 0 AND quantity_rejected >= 0
        AND quantity_delivered = quantity_accepted + quantity_rejected + quantity_held_recoverable
        AND quantity_delivered + quantity_missing + quantity_deferred >= quantity_expected
      ))
    );
  `);
  // PostgreSQL enum values are intentionally not removed on down() (0133/0195 precedent):
  // held / discarded / receive_recovery remain, unused.
}
