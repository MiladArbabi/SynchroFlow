import type { Knex } from 'knex';
import {
  isValidTier,
  type Tier,
} from '@lasyncro/backend-core/config/tiers.js';

const USAGE_PERIOD_LOCK_NAMESPACE = 91001;

export type UsagePeriodRow = {
  id: number;
  shop_id: number;
  tier_at_period_start: Tier;
  period_starts_at: Date | string;
  period_ends_at: null;
  ingested_orders: number;
  shipped_orders: number;
};

/**
 * Returns the shop's open usage period and lazily rotates stale Starter
 * periods at the UTC calendar-month boundary.
 *
 * Paid tiers remain invoice-driven. The transaction-scoped advisory lock
 * serializes concurrent reads/writes so the partial unique index can never
 * receive two open periods for the same shop.
 */
export async function getOrRotateOpenUsagePeriod(
  // Must be the caller's active tenant-scoped transaction. Typed as Knex
  // because withTenant() currently widens its runtime transaction callback.
  trx: Knex,
  shopId: number,
  now = new Date()
): Promise<UsagePeriodRow> {
  await trx.raw(
    'SELECT pg_advisory_xact_lock(?, ?)',
    [USAGE_PERIOD_LOCK_NAMESPACE, shopId]
  );

  const subscription = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier');

  const rawTier = subscription?.tier ?? 'starter';
  const tier: Tier = isValidTier(rawTier) ? rawTier : 'starter';

  const openPeriod = await trx<UsagePeriodRow>('shop_usage_metrics')
    .where({ shop_id: shopId })
    .whereNull('period_ends_at')
    .orderBy('period_starts_at', 'desc')
    .first();

  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );

  const openPeriodStart = openPeriod
    ? new Date(openPeriod.period_starts_at)
    : null;
  const starterPeriodIsCurrent =
    openPeriodStart !== null &&
    openPeriodStart.getTime() >= currentMonthStart.getTime();

  if (
    openPeriod &&
    (tier !== 'starter' || starterPeriodIsCurrent)
  ) {
    return openPeriod;
  }

  if (openPeriod) {
    await trx('shop_usage_metrics')
      .where({ id: openPeriod.id, shop_id: shopId })
      .whereNull('period_ends_at')
      .update({
        period_ends_at: currentMonthStart,
        updated_at: now,
      });
  }

  const periodStart = tier === 'starter'
    ? currentMonthStart
    : now;

  const [newPeriod] = await trx<UsagePeriodRow>('shop_usage_metrics')
    .insert({
      shop_id: shopId,
      tier_at_period_start: tier,
      period_starts_at: periodStart,
      period_ends_at: null,
    })
    .returning('*');

  if (!newPeriod) {
    throw new Error(
      `[billing][usage_period] failed to open period for shop ${shopId}`
    );
  }

  console.info('[billing][usage_period] opened', {
    shopId,
    tier,
    periodStart,
    reason: openPeriod
      ? 'starter_calendar_month_rotated'
      : 'missing_open_period',
  });

  return newPeriod;
}