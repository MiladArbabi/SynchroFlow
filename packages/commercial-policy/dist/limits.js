// @lasyncro/commercial-policy — canonical standard plan limits + pricing.
//
// These values are the verified production truth (backend-core TIER_CONFIG as
// of 2026-09). The frontend `config/tiers.ts` copies currently DRIFT from
// these (shipped cap Core 200/Growth 1000, seat Starter 1/Core 3) — that is
// tracked compatibility debt to be migrated in P0-A2/A3, not here.
export const PLAN_LIMITS = Object.freeze({
    starter: { seatLimit: 0, monthlyOrderCap: 50, shippedOrderCap: 50, specterSessionCap: 500 },
    core: { seatLimit: 2, monthlyOrderCap: 2000, shippedOrderCap: 500, specterSessionCap: 5000 },
    growth: { seatLimit: 5, monthlyOrderCap: 10000, shippedOrderCap: 2500, specterSessionCap: 25000 },
    scale: { seatLimit: Infinity, monthlyOrderCap: Infinity, shippedOrderCap: Infinity, specterSessionCap: Infinity },
});
/** Canonical standard limits for a tier. */
export function standardLimits(tier) {
    return PLAN_LIMITS[tier];
}
/** Display price in USD cents/month (0 = free). Preserved verbatim. */
export const PLAN_PRICING_CENTS = Object.freeze({
    starter: 0,
    core: 7900,
    growth: 17900,
    scale: 34900,
});
