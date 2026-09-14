import type { Tier } from './tiers.js';
export interface PlanLimits {
    /** Included non-owner seats. The owner seat is not counted here. */
    seatLimit: number;
    /**
     * Order-ingestion telemetry threshold.
     * This is NOT an ingestion gate and must never cause Shopify truth to be dropped.
     */
    monthlyOrderCap: number;
    /** Included warehouse-processed orders per billing period. */
    shippedOrderCap: number;
    /** Included physical warehouse locations. */
    locationLimit: number;
    /** Visible historical order window in days. Data beyond this is retained. */
    historyDays: number;
    /**
     * Legacy/deprecated Specter compatibility metric.
     * Not part of the MON-REM-01B primary commercial model.
     */
    specterSessionCap: number;
}
export declare const PLAN_LIMITS: Readonly<Record<Tier, PlanLimits>>;
/** Canonical standard limits for a tier. */
export declare function standardLimits(tier: Tier): PlanLimits;
/**
 * Ratified USD monthly commercial anchors in cents.
 *
 * Scale's 59900 value is an internal/private commercial anchor.
 * Scale remains Contact / negotiated on merchant-facing self-service surfaces.
 */
export declare const PLAN_PRICING_CENTS: Readonly<Record<Tier, number>>;
/**
 * Per additional warehouse-processed order, in USD cents.
 *
 * Starter has no WMS execution allowance and therefore no usage overage rate.
 */
export declare const PLAN_PROCESSED_ORDER_OVERAGE_CENTS: Readonly<Record<Tier, number | null>>;
