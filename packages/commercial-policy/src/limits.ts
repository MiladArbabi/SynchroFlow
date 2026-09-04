// @lasyncro/commercial-policy — canonical standard plan limits + pricing.
//
// These values are the verified production truth (backend-core TIER_CONFIG as
// of 2026-09). The frontend `config/tiers.ts` copies currently DRIFT from
// these (shipped cap Core 200/Growth 1000, seat Starter 1/Core 3) — that is
// tracked compatibility debt to be migrated in P0-A2/A3, not here.

import type { Tier } from './tiers.js';

export interface PlanLimits {
  /** Non-owner seats included. Infinity = unlimited. */
  seatLimit: number;
  /** Orders ingested per calendar month. Infinity = unlimited. */
  monthlyOrderCap: number;
  /** Orders shipped via WMS per billing period. Infinity = unlimited. */
  shippedOrderCap: number;
  /** Specter sessions per billing period. Infinity = unlimited. */
  specterSessionCap: number;
}

export const PLAN_LIMITS: Readonly<Record<Tier, PlanLimits>> = Object.freeze({
  starter: { seatLimit: 0,        monthlyOrderCap: 50,       shippedOrderCap: 50,       specterSessionCap: 500 },
  core:    { seatLimit: 2,        monthlyOrderCap: 2000,     shippedOrderCap: 500,      specterSessionCap: 5000 },
  growth:  { seatLimit: 5,        monthlyOrderCap: 10000,    shippedOrderCap: 2500,     specterSessionCap: 25000 },
  scale:   { seatLimit: Infinity, monthlyOrderCap: Infinity, shippedOrderCap: Infinity, specterSessionCap: Infinity },
});

/** Canonical standard limits for a tier. */
export function standardLimits(tier: Tier): PlanLimits {
  return PLAN_LIMITS[tier];
}

/** Display price in USD cents/month (0 = free). Preserved verbatim. */
export const PLAN_PRICING_CENTS: Readonly<Record<Tier, number>> = Object.freeze({
  starter: 0,
  core: 7900,
  growth: 17900,
  scale: 34900,
});
