import type { Knex } from 'knex';

/**
 * RECOUNT-FRESH-37
 * WHY: expected_quantity is snapshotted at task creation and never re-read
 * (inventoryRecount.service.ts:243-248). Any movement landing on the bin
 * before the count — a pick, a sale, a stow — surfaces as variance, and
 * commitRecount writes that variance into inventory_movements as a
 * reconciliation_correction. The units are then debited twice: once by the
 * real movement, once as fabricated shrinkage.
 *
 * window_delta is SUM(quantity_delta) over inventory_movements for this
 * line's variant+location between line creation and count time. Variance is
 * derived from expected_quantity + window_delta, so a movement nets out
 * instead of becoming a correction.
 *
 * Persisted rather than computed on read: a value recomputed at review time
 * would change on every page load, which is indefensible on a screen the
 * owner uses to authorise a ledger write. Frozen at count time it is
 * auditable alongside counted_at.
 *
 * window_from is stored explicitly rather than reusing created_at, because
 * reviewLine('recount') creates a replacement line whose window must open at
 * the ORIGINAL line's creation, not the replacement's.
 *
 * NULL on all three = counted before this migration, or not yet counted.
 * Distinguishing "no movements in the window" (0) from "never computed"
 * (NULL) matters: only the former proves the ledger was checked.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('inventory_recount_lines');
  if (!hasTable) {
    throw new Error('[0159] inventory_recount_lines missing — 0153 must run first');
  }
  await knex.schema.alterTable('inventory_recount_lines', (table) => {
    table.integer('window_delta').nullable();
    table.timestamp('window_from', { useTz: true }).nullable();
    table.timestamp('window_computed_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('inventory_recount_lines', (table) => {
    table.dropColumn('window_computed_at');
    table.dropColumn('window_from');
    table.dropColumn('window_delta');
  });
}