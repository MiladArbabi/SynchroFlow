// apps/backend/src/services/order-intelligence/orderIntelligence.service.ts

/**
 * Order Intelligence Service (Layer 2)
 * -----------------------------------
 * Purpose:
 * - Convert raw, factual order metrics into classified intelligence.
 *
 * Guarantees:
 * - NO database access
 * - NO UI formatting
 * - NO inference when facts are missing
 * - Deterministic output
 *
 * This layer may:
 * - Classify (good / bad / unknown)
 * - Derive directional signals (up / down / flat)
 *
 * This layer may NOT:
 * - Explain causality
 * - Recommend actions
 * - Expose narratives
 */

import type { OrderFacts } from '../order-facts/orderFacts.types';
import { OrderTrendFacts } from '../order-facts/orderTrendFacts.service';

/**
 * Intelligence Thresholds (INTERNAL)
 * ---------------------------------
 * These constants define when order data is considered
 * epistemically safe to interpret.
 *
 * IMPORTANT:
 * - They are NOT configuration.
 * - They are NOT exposed.
 * - They exist solely to ensure deterministic behavior.
 */
const COVERAGE_MIN_USABLE_PCT = 80;

/**
 * Trend Detection Constants (INTERNAL)
 * -----------------------------------
 * These constants define how directional change is classified.
 *
 * IMPORTANT:
 * - Fixed and non-configurable
 * - Express direction only (no strength, no forecast)
 * - Used solely for orientation
 */
const TREND_DELTA_THRESHOLD = 0.05; // 5% change

/* ----------------------------------------
 * Intelligence Types (INTERNAL ONLY)
 * ------------------------------------- */

export type OrderHealthStatus = 'healthy' | 'loss' | 'unknown';

export type TrendDirection =
  | 'up'
  | 'down'
  | 'flat'
  | 'unknown';

export type EconomicVisibilityStatus =
  | 'sufficient'
  | 'insufficient'
  | 'unknown';

 export interface OrderNexusIntelligence {
   margin: {
     averagePct: number | null;
     status: OrderHealthStatus;
   };

  trend: {
    direction: TrendDirection;
  };


  /**
   * WARNING:
   * --------
   * dataCoveragePct is INTELLIGENCE-ONLY.
   * It must NEVER be exposed via FT2.
   *
   * FT2 consumes downgraded factual coverage only.
   */
  dataCoveragePct: number | null;

  /**
   * Economic visibility expresses whether order data
   * is reliable enough to orient the business.
   *
   * INTERNAL signal — must be downgraded by FTEP.
   */
  visibility: {
    status: 'sufficient' | 'insufficient' | 'unknown';
  };
}

/* ----------------------------------------
 * Intelligence Derivation
 * ------------------------------------- */

/**
 * deriveDataUsable
 * ----------------
 * Determines whether order data is sufficiently complete
 * to support economic interpretation.
 *
 * Semantics:
 * - null  → cannot assess usability
 * - false → data exists but is insufficient
 * - true  → interpretation allowed
 *
 * This function establishes a HARD epistemic boundary.
 */
function deriveDataUsable(
  completenessPct: number | null
): boolean | null {
  if (completenessPct === null) return null;
  if (completenessPct < COVERAGE_MIN_USABLE_PCT) return false;
  return true;
}

/**
 * deriveMarginStatus
 * ------------------
 * Classifies the economic outcome of orders using
 * revenue presence and data usability.
 *
 * IMPORTANT:
 * - This is NOT profit or margin.
 * - Cost is intentionally unavailable.
 * - Classification is directional, not explanatory.
 *
 * Semantics:
 * - 'unknown' → insufficient data to judge
 * - 'loss'    → revenue exists but is non-positive
 * - 'healthy' → revenue exists and is positive
 */
function deriveMarginStatus(
  revenueTotal: number | null,
  dataUsable: boolean | null
): 'healthy' | 'loss' | 'unknown' {
  if (dataUsable !== true) return 'unknown';
  if (revenueTotal === null) return 'unknown';
  if (revenueTotal <= 0) return 'loss';
  return 'healthy';
}

/**
 * deriveTrendDirection
 * --------------------
 * Classifies order volume direction by comparing two
 * consecutive fixed windows, ONLY when economic data
 * is epistemically usable.
 *
 * Coverage gating dominates time availability.
 *
 * Semantics:
 * - 'unknown' → insufficient data or unusable coverage
 * - 'up'      → sustained increase above threshold
 * - 'down'    → sustained decrease below threshold
 * - 'flat'    → no meaningful directional change
 *
 * This function is:
 * - Deterministic
 * - Non-predictive
 * - Non-explanatory
 */
function deriveTrendDirection(
  prev: number | null,
  curr: number | null,
  dataUsable: boolean | null
): TrendDirection {
  if (dataUsable !== true) return 'unknown';
  if (prev === null || curr === null) return 'unknown';
  if (prev === 0) return 'unknown';

  const delta = (curr - prev) / prev;

  if (delta > TREND_DELTA_THRESHOLD) return 'up';
  if (delta < -TREND_DELTA_THRESHOLD) return 'down';
  return 'flat';
}

/**
 * deriveEconomicVisibility
 * ------------------------
 * Downgraded representation of data usability.
 *
 * Semantics:
 * - unknown      → cannot assess visibility
 * - insufficient → data exists but is not reliable
 * - sufficient   → data supports economic orientation
 *
 * This is NOT advice.
 * This is NOT explanation.
 * It is a constraint made visible.
 */
function deriveEconomicVisibility(
  dataUsable: boolean | null
): EconomicVisibilityStatus {
  if (dataUsable === null) return 'unknown';
  if (dataUsable === false) return 'insufficient';
  return 'sufficient';
}

/**
 * deriveOrderIntelligence
 * -----------------------
 * Pure transformation from OrderFacts → OrderNexusIntelligence
 */
export function deriveOrderIntelligence(
  facts: OrderFacts,
  trendFacts: OrderTrendFacts
): OrderNexusIntelligence {

  const dataUsable = deriveDataUsable(
    facts.dataCoverage.completenessPct ?? null
  );

  const marginStatus = deriveMarginStatus(
  facts.totals.revenueTotal ?? null,
  dataUsable
);

const trendDirection = deriveTrendDirection(
  trendFacts.previousWindowOrders,
  trendFacts.currentWindowOrders,
  dataUsable
);

const intelligence: OrderNexusIntelligence = {
  margin: {
    averagePct: null, // intentionally inactive
    status: marginStatus,
  },

  trend: {
    direction: trendDirection,
  },

  dataCoveragePct: facts.dataCoverage.completenessPct ?? null,

  visibility: {
    status: deriveEconomicVisibility(dataUsable),
  },
};

  return intelligence;
}