// @lasyncro/commercial-policy — canonical standard plan limits + economics.
//
// MON-REM-01B:
// - Shopify order ingestion remains unconditional; monthlyOrderCap is telemetry.
// - shippedOrderCap is the included warehouse-processed-order allowance.
// - paid-tier overage economics are separate from capability entitlement.
// - Scale is high-capacity, not unlimited.
// - historyDays is a visibility horizon only; canonical data is never deleted.

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
}

export const PLAN_LIMITS: Readonly<Record<Tier, PlanLimits>> = Object.freeze({
  starter: {
    seatLimit: 0,
    monthlyOrderCap: 50,
    shippedOrderCap: 0,
    locationLimit: 1,
    historyDays: 30,
  },
  core: {
    seatLimit: 3,
    monthlyOrderCap: 2000,
    shippedOrderCap: 2000,
    locationLimit: 1,
    historyDays: 90,
  },
  growth: {
    seatLimit: 10,
    monthlyOrderCap: 10000,
    shippedOrderCap: 7500,
    locationLimit: 3,
    historyDays: 365,
  },
  scale: {
    seatLimit: 25,
    monthlyOrderCap: 50000,
    shippedOrderCap: 20000,
    locationLimit: 10,
    historyDays: 730,
  },
});

/** Canonical standard limits for a tier. */
export function standardLimits(tier: Tier): PlanLimits {
  return PLAN_LIMITS[tier];
}

/**
 * Ratified USD monthly commercial anchors in cents.
 *
 * Scale's 59900 value is an internal/private commercial anchor.
 * Scale remains Contact / negotiated on merchant-facing self-service surfaces.
 */
export const PLAN_PRICING_CENTS: Readonly<Record<Tier, number>> = Object.freeze({
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
export const PLAN_PROCESSED_ORDER_OVERAGE_CENTS:
  Readonly<Record<Tier, number | null>> = Object.freeze({
    starter: null,
    core: 8,
    growth: 6,
    scale: 4,
  });
