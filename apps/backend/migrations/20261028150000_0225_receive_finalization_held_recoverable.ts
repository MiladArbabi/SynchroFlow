import type { Knex } from 'knex';

/** S8-C5 / S4-3A — grouped finalization accounts for recoverable held units.
 *
 * 0210's receive_reconciliation_finalization_lines balanced
 *   accepted + rejected + missing + deferred = expected + overage_approved
 * and had no held column, so a grouped line holding units for recovery could
 * never be finalized truthfully. Held units are delivered (0208 / 0224 line
 * identity), so they join the left-hand side:
 *   accepted + rejected + held + missing + deferred = expected + overage_approved
 *
 * Additive only. Existing rows take held = 0 (a metadata-only default; the
 * table's append-only triggers never fire) and keep their exact balance.
 * Nothing writes held > 0 until S4-3B.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE receive_reconciliation_finalization_lines
      ADD COLUMN quantity_held_recoverable integer NOT NULL DEFAULT 0
        CONSTRAINT receive_reconciliation_finalization_lines_held_nonnegative
          CHECK (quantity_held_recoverable >= 0);
    ALTER TABLE receive_reconciliation_finalization_lines
      DROP CONSTRAINT receive_reconciliation_finalization_lines_balanced;
    ALTER TABLE receive_reconciliation_finalization_lines
      ADD CONSTRAINT receive_reconciliation_finalization_lines_balanced CHECK (
        quantity_accepted + quantity_rejected + quantity_held_recoverable + quantity_missing + quantity_deferred
          = quantity_expected + quantity_overage_approved
      );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0210/0224: persisted held accounting
  // wins over rollback convenience. Lock first so no evidence can be written
  // between the check and schema removal.
  await knex.raw(`LOCK TABLE receive_reconciliation_finalization_lines IN ACCESS EXCLUSIVE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM receive_reconciliation_finalization_lines WHERE quantity_held_recoverable > 0
    ) AS has_evidence
  `);
  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_FINALIZATION_HELD_ROLLBACK_BLOCKED] persisted held finalization accounting exists; 0225 cannot be removed'
    );
  }

  await knex.raw(`
    ALTER TABLE receive_reconciliation_finalization_lines
      DROP CONSTRAINT receive_reconciliation_finalization_lines_balanced;
    ALTER TABLE receive_reconciliation_finalization_lines
      ADD CONSTRAINT receive_reconciliation_finalization_lines_balanced CHECK (
        quantity_accepted + quantity_rejected + quantity_missing + quantity_deferred
          = quantity_expected + quantity_overage_approved
      );
    ALTER TABLE receive_reconciliation_finalization_lines DROP COLUMN quantity_held_recoverable;
  `);
}
