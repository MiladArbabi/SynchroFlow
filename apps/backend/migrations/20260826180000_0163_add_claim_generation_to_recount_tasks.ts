import type { Knex } from 'knex';

/**
 * RECOUNT-CLAIM-ABANDONED-131
 *
 * WHY: Reassignment updates claimed_by/assigned_to/claimed_at on an existing
 * task, but browser-local provisional state (RECOUNT-TALLY-VOLATILE-127's
 * recount-scan-tally-${taskId} / recount-verified-location-${taskId}) is keyed
 * by task id alone. A reassigned claimant's session would silently restore
 * the PREVIOUS claimant's leftover scans. claim_generation is a fresh,
 * unpredictable id written on every claim/reassignment; the frontend keys its
 * sessionStorage by task+generation instead of task alone, so a new claim
 * generation can never read a previous one's local state.
 *
 * Deliberately NOT derived from claimed_at: WORKSHOP requires an opaque
 * generation id, independent of any timestamp representation/formatting
 * concern in a storage key.
 *
 * Nullable, no backfill: every existing row (dispatched/claimed/counting/
 * manual_review/committed) keeps claim_generation = NULL. Only claim and
 * reassignment write it going forward — no destructive rewrite of historical
 * terminal rows, matching migration 0158/0162's precedent of additive,
 * backward-compatible columns.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('inventory_recount_tasks');
  if (!hasTable) {
    throw new Error('[0163] inventory_recount_tasks missing — 0153 must run first');
  }

  await knex.schema.alterTable('inventory_recount_tasks', (table) => {
    table.uuid('claim_generation').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('inventory_recount_tasks', (table) => {
    table.dropColumn('claim_generation');
  });
}
