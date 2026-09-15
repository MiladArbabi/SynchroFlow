import type { Knex } from 'knex';
import { isValidTier, standardLimits, type Tier } from '@lasyncro/commercial-policy';

export interface SeatCapacity {
  tier: Tier;
  current: number;
  baseLimit: number;
  extraSeats: number;
  limit: number;
}

export interface ResolveSeatCapacityOptions {
  lockSubscription?: boolean;
}

export async function resolveSeatCapacity(
  trx: Knex.Transaction,
  shopId: number,
  options: ResolveSeatCapacityOptions = {},
): Promise<SeatCapacity> {
  let subscriptionQuery = trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .select('tier', 'extra_seats');

  if (options.lockSubscription) {
    subscriptionQuery = subscriptionQuery.forUpdate();
  }

  const subscription = await subscriptionQuery.first();
  const rawTier = subscription?.tier ?? 'starter';
  const tier = isValidTier(rawTier) ? rawTier : 'starter';
  const baseLimit = standardLimits(tier).seatLimit;

  const extraSeats =
    tier === 'core' || tier === 'growth'
      ? Math.max(0, Number(subscription?.extra_seats ?? 0))
      : 0;

  const activeSeatCount = await trx('shop_memberships')
    .where({ shop_id: shopId })
    .whereNull('revoked_at')
    .whereNot('role', 'owner')
    .count('id as count')
    .first();

  const current = Number(activeSeatCount?.count ?? 0);
  const limit = baseLimit + extraSeats;

  return {
    tier,
    current,
    baseLimit,
    extraSeats,
    limit,
  };
}
