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
export declare const PLAN_LIMITS: Readonly<Record<Tier, PlanLimits>>;
/** Canonical standard limits for a tier. */
export declare function standardLimits(tier: Tier): PlanLimits;
/** Display price in USD cents/month (0 = free). Preserved verbatim. */
export declare const PLAN_PRICING_CENTS: Readonly<Record<Tier, number>>;
