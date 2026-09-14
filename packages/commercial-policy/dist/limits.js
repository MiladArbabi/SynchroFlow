// @lasyncro/commercial-policy — canonical standard plan limits + economics.
//
// MON-REM-01B:
// - Shopify order ingestion remains unconditional; monthlyOrderCap is telemetry.
// - shippedOrderCap is the included warehouse-processed-order allowance.
// - paid-tier overage economics are separate from capability entitlement.
// - Scale is high-capacity, not unlimited.
// - historyDays is a visibility horizon only; canonical data is never deleted.
export const PLAN_LIMITS = Object.freeze({
    starter: {
        seatLimit: 0,
        monthlyOrderCap: 50,
        shippedOrderCap: 0,
        locationLimit: 1,
        historyDays: 30,
        specterSessionCap: 500,
    },
    core: {
        seatLimit: 3,
        monthlyOrderCap: 2000,
        shippedOrderCap: 2000,
        locationLimit: 1,
        historyDays: 90,
        specterSessionCap: 5000,
    },
    growth: {
        seatLimit: 10,
        monthlyOrderCap: 10000,
        shippedOrderCap: 7500,
        locationLimit: 3,
        historyDays: 365,
        specterSessionCap: 25000,
    },
    scale: {
        seatLimit: 25,
        monthlyOrderCap: 50000,
        shippedOrderCap: 20000,
        locationLimit: 10,
        historyDays: 730,
        // Deprecated compatibility metric; not a current monetization dimension.
        specterSessionCap: Infinity,
    },
});
/** Canonical standard limits for a tier. */
export function standardLimits(tier) {
    return PLAN_LIMITS[tier];
}
/**
 * Ratified USD monthly commercial anchors in cents.
 *
 * Scale's 59900 value is an internal/private commercial anchor.
 * Scale remains Contact / negotiated on merchant-facing self-service surfaces.
 */
export const PLAN_PRICING_CENTS = Object.freeze({
    starter: 0,
    core: 9900,
    growth: 24900,
    scale: 59900,
});
/**
 * Per additional warehouse-processed order, in USD cents.
 *
 * Starter has no WMS execution allowance and therefore no usage overage rate.
 */
export const PLAN_PROCESSED_ORDER_OVERAGE_CENTS = Object.freeze({
    starter: null,
    core: 8,
    growth: 6,
    scale: 4,
});
