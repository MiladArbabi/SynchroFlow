import type { Knex } from 'knex';

/**
 * COMMERCIAL-DEAD-SURFACE-01D-5
 *
 * Historical persisted-entitlement repair.
 *
 * Canonical commercial policy already makes these dead / paused identities
 * non-effective at runtime. Historical rows can nevertheless remain
 * temporally open in shop_module_entitlements.
 *
 * This migration closes those stale open grants without deleting history.
 *
 * Invariants:
 * - UPDATE only; never DELETE.
 * - Only rows whose valid_from has already begun are eligible.
 * - Only rows with valid_until IS NULL are eligible.
 * - Already-closed rows remain untouched.
 * - Future-not-started rows remain untouched.
 * - Unrelated live grants remain untouched.
 * - Re-running is idempotent.
 * - down() never resurrects historical access.
 */

export const NON_EFFECTIVE_MODULES = [
  'echo-hub',
  'customers',
  'specter',
  'specter_sdk_free',
  'finances',
  'cashflow',
] as const;

export const NON_ACTIVE_FLAGS = [
  'finances.core',
  'finances.cashflow',
  'cashflow.revenue_buckets',
  'customers.ltv',
  'customers.segmentation',
  'specter.full_capture',
] as const;

/**
 * Exported migration-local helper so the disposable-DB integration contract
 * can reproduce historical production state after all migrations have run.
 */
export async function closeHistoricalNonEffectiveEntitlements(
  knex: Knex | Knex.Transaction,
  closedAt: Date,
): Promise<number> {
  const updated = await knex('shop_module_entitlements')
    .whereNull('valid_until')
    .andWhere('valid_from', '<=', closedAt)
    .andWhere((qb) => {
      qb.whereIn('module_key', [...NON_EFFECTIVE_MODULES])
        .orWhereIn('flag_key', [...NON_ACTIVE_FLAGS]);
    })
    .update({
      valid_until: closedAt,
    });

  return Number(updated);
}

export async function up(knex: Knex): Promise<void> {
  const result = await knex.raw<{ rows: Array<{ closed_at: Date | string }> }>(
    'SELECT CURRENT_TIMESTAMP AS closed_at',
  );

  const rawClosedAt = result.rows[0]?.closed_at;

  if (!rawClosedAt) {
    throw new Error(
      'COMMERCIAL-DEAD-SURFACE-01D-5: database did not return closure timestamp',
    );
  }

  const closedAt = new Date(rawClosedAt);

  if (Number.isNaN(closedAt.getTime())) {
    throw new Error(
      'COMMERCIAL-DEAD-SURFACE-01D-5: invalid database closure timestamp',
    );
  }

  await closeHistoricalNonEffectiveEntitlements(knex, closedAt);
}

/**
 * Forward-only data repair.
 *
 * Reopening historical commercial grants on rollback would restore access that
 * canonical policy has explicitly withdrawn, so down() is intentionally a no-op.
 */
export async function down(_knex: Knex): Promise<void> {
  // Deliberately irreversible.
}
