// apps/backend/src/services/billing/providerPriceResolver.service.ts
//
// BILL-ENTITLEMENT-01 / P0-B3 — canonical Stripe provider-price resolver.
// ============================================================================
// THE PROVIDER FACT, NOT THE METADATA, DECIDES THE TIER.
//
// Before this module, handleSubscriptionUpsert read `sub.metadata.tier` and
// nothing ever compared it to the price Stripe actually charges. Metadata is
// mutable, is not rewritten by portal-driven plan changes, and is absent on any
// subscription created outside our own checkout — so entitlements and revenue
// could diverge silently and permanently.
//
// Authoritative direction is now:
//
//     price.id  ->  { tier, currency, interval, itemKind }
//
// built by INVERTING the same PRICE_ID_ENV_KEYS / SEAT_PRICE_ID_ENV_KEYS tables
// that `getStripePriceId` / `getSeatPriceId` use for outbound checkout. There is
// deliberately no second hand-maintained list: a reverse map that can drift from
// the forward map would reintroduce exactly the class of defect this closes.
//
// FAIL-CLOSED RULES
//   - unknown price id                       -> throw
//   - zero known base items                  -> throw
//   - more than one known base item          -> throw
//   - ANY unrecognized item on the sub       -> throw (never "assume not-seat")
//   - no `items[0]` fallback, ever
//   - metadata NEVER rescues an unresolvable purchase
//
// metadata.tier survives only as a diagnostic cross-check surfaced on the
// result, so a disagreement becomes inspectable provenance instead of a silent
// mis-entitlement.

import {
  PRICE_ID_ENV_KEYS,
  SEAT_PRICE_ID_ENV_KEYS,
  type BillingCurrency,
  type BillingInterval,
  type SeatTier,
} from '@lasyncro/backend-core/config/pricing.config.js';
import type { Tier } from '@lasyncro/backend-core/config/tiers.js';

export type StripeItemKind = 'base' | 'seat_addon';

export interface StripePriceIdentity {
  tier: Tier;
  currency: BillingCurrency;
  /** Present for base prices; absent for seat add-ons (seats are monthly-only). */
  interval?: BillingInterval;
  itemKind: StripeItemKind;
  /** The env var this price id is configured under — provenance, not a secret. */
  envKey: string;
}

export interface StripeSubscriptionCommercial {
  tier: Tier;
  interval: BillingInterval;
  currency: BillingCurrency;
  basePriceId: string;
  /** The raw Stripe item that resolved as the base line — period bounds come from it. */
  baseItem: any;
  extraSeats: number;
  /** Diagnostic only. Never an input to `tier`. */
  metadataTier: string | null;
  metadataDisagreement: boolean;
}

interface ReverseTable {
  byPriceId: Map<string, StripePriceIdentity>;
  missingKeys: string[];
}

/**
 * Builds the reverse table from the current environment on every call.
 *
 * Deliberately not memoized at module scope: price configuration is process
 * environment, and a resolver that cached a partial table at import time would
 * reproduce the silent-degradation bug this module exists to remove.
 * The table is 24 entries — the cost is irrelevant next to a webhook round trip.
 */
function buildReverseTable(): ReverseTable {
  const byPriceId = new Map<string, StripePriceIdentity>();
  const missingKeys: string[] = [];

  const claim = (priceId: string, identity: StripePriceIdentity) => {
    const existing = byPriceId.get(priceId);
    if (existing) {
      // Two commercial meanings for one price id is unresolvable ambiguity —
      // refuse to guess which one the merchant bought.
      throw new Error(
        `[provider-price] duplicate Stripe price configuration: the same price id is ` +
          `configured under both ${existing.envKey} and ${identity.envKey}`
      );
    }
    byPriceId.set(priceId, identity);
  };

  for (const [tier, byCurrency] of Object.entries(PRICE_ID_ENV_KEYS)) {
    for (const [currency, byInterval] of Object.entries(byCurrency)) {
      for (const [interval, envKey] of Object.entries(byInterval)) {
        const priceId = process.env[envKey as string];
        if (!priceId) {
          missingKeys.push(envKey as string);
          continue;
        }
        claim(priceId, {
          tier: tier as Tier,
          currency: currency as BillingCurrency,
          interval: interval as BillingInterval,
          itemKind: 'base',
          envKey: envKey as string,
        });
      }
    }
  }

  for (const [tier, byCurrency] of Object.entries(SEAT_PRICE_ID_ENV_KEYS)) {
    for (const [currency, envKey] of Object.entries(byCurrency)) {
      const priceId = process.env[envKey as string];
      if (!priceId) {
        missingKeys.push(envKey as string);
        continue;
      }
      claim(priceId, {
        tier: tier as SeatTier as Tier,
        currency: currency as BillingCurrency,
        itemKind: 'seat_addon',
        envKey: envKey as string,
      });
    }
  }

  return { byPriceId, missingKeys };
}

/**
 * Fails loudly when any commercial price is unconfigured.
 *
 * Call this at deploy/boot verification. It is intentionally NOT called from the
 * resolvers below: a webhook must fail on the specific item it cannot recognize,
 * not on an unrelated currency the shop never uses.
 */
export function assertStripePriceConfigComplete(): void {
  const { missingKeys } = buildReverseTable();
  if (missingKeys.length > 0) {
    throw new Error(
      `[provider-price] incomplete Stripe price configuration. Missing env vars: ` +
        `${missingKeys.sort().join(', ')}`
    );
  }
}

/** Resolves one Stripe price id to its canonical commercial meaning. Throws if unknown. */
export function resolveStripePriceIdentity(priceId: string): StripePriceIdentity {
  const { byPriceId } = buildReverseTable();
  const identity = byPriceId.get(priceId);
  if (!identity) {
    // No metadata fallback. An unrecognized purchase is unresolvable, full stop.
    throw new Error(`[provider-price] unrecognized Stripe price id: "${priceId}"`);
  }
  return identity;
}

/**
 * Resolves a whole Stripe subscription object to its canonical commercial state.
 *
 * Every line item must be recognizable. Exactly one must be a base tier line.
 * Seat counts come only from lines that genuinely resolve as seat add-ons — an
 * unset seat env var makes that line UNKNOWN (and therefore fatal) rather than
 * silently reclassifying it as the base tier line.
 */
export function resolveStripeSubscriptionCommercial(
  subscription: any
): StripeSubscriptionCommercial {
  const { byPriceId } = buildReverseTable();
  const items: any[] = subscription?.items?.data ?? [];

  if (items.length === 0) {
    throw new Error('[provider-price] Stripe subscription carries no line items');
  }

  const baseMatches: Array<{ item: any; identity: StripePriceIdentity }> = [];
  const seatMatches: Array<{ item: any; identity: StripePriceIdentity }> = [];
  const unknownPriceIds: string[] = [];

  for (const item of items) {
    const priceId = item?.price?.id;
    const identity = typeof priceId === 'string' ? byPriceId.get(priceId) : undefined;
    if (!identity) {
      unknownPriceIds.push(String(priceId ?? '<missing price id>'));
      continue;
    }
    if (identity.itemKind === 'base') baseMatches.push({ item, identity });
    else seatMatches.push({ item, identity });
  }

  if (unknownPriceIds.length > 0) {
    // An unrecognized line is ambiguous by construction: it could be a tier line,
    // an add-on, or a mistake. Guessing is what the old `find(not-a-seat)` did.
    throw new Error(
      `[provider-price] unrecognized Stripe line item(s) on subscription ` +
        `${subscription?.id ?? '<unknown>'}: ${unknownPriceIds.join(', ')}`
    );
  }

  if (baseMatches.length === 0) {
    throw new Error(
      `[provider-price] no base tier line item on Stripe subscription ` +
        `${subscription?.id ?? '<unknown>'}`
    );
  }
  if (baseMatches.length > 1) {
    throw new Error(
      `[provider-price] ambiguous Stripe subscription ${subscription?.id ?? '<unknown>'}: ` +
        `${baseMatches.length} base tier line items`
    );
  }

  const base = baseMatches[0];
  const extraSeats = seatMatches.reduce(
    (sum, m) => sum + (Number(m.item?.quantity) || 0),
    0
  );

  const rawMetadataTier = subscription?.metadata?.tier;
  const metadataTier = typeof rawMetadataTier === 'string' ? rawMetadataTier : null;

  return {
    tier: base.identity.tier,
    interval: base.identity.interval as BillingInterval,
    currency: base.identity.currency,
    basePriceId: base.item.price.id,
    baseItem: base.item,
    extraSeats,
    metadataTier,
    // Diagnostic signal only — the price has already decided `tier` above.
    metadataDisagreement: metadataTier !== null && metadataTier !== base.identity.tier,
  };
}
