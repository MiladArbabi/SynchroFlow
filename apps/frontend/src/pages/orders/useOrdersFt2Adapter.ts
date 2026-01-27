// apps/frontend/src/pages/orders/useOrdersFt2Adapter.ts
import type { OrdersModuleFT2DataProps } from '@lasyncro/order-nexus';
import { OrdersFt2Snapshot } from './useOrdersFt2Snapshot';

/**
 * formatPctDiff (UI-only)
 * ----------------------
 * Converts numeric percentage change into
 * a stable, presentation-safe string.
 *
 * Rules:
 * - null / undefined → null
 * - 0 → "0%"
 * - positive → "+X%"
 * - negative → "-X%"
 * - No symbols beyond + / -
 */
function formatPctDiff(value?: number | null): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;

  if (value === 0) return '0%';
  return value > 0 ? `+${value}%` : `${value}%`;
}

/**
 * mapOrdersFt2Props
 * -----------------
 * Canonical FT2 Orders adapter.
 *
 * This function is a **pure adapter**.
 *
 * Core invariants (non-negotiable):
 * - No inference
 * - No computation
 * - No lifecycle awareness
 * - No semantic translation
 * - No defaults other than `undefined → null`
 * - Deterministic output for the same input
 *
 * Mental model:
 * Backend snapshot → FT2 UI window
 * The adapter is a *pipe*, not a brain.
 */
export function mapOrdersFt2Props(
  snapshot: OrdersFt2Snapshot,
  trust: { trustEligible: boolean | null } | null
): OrdersModuleFT2DataProps & {
  trust: { trustEligible: boolean | null } | null;
} {

  return {
  /**
   * ─────────────────────────────────────────
   * 🧭 SYSTEM GROUNDING (FOUNDATIONAL)
   * ─────────────────────────────────────────
   */

  orders: {
    total:
      snapshot.orders?.total === undefined
        ? null
        : snapshot.orders.total,

    fulfilled:
      snapshot.orders?.fulfilled === undefined
        ? null
        : snapshot.orders.fulfilled,

    unfulfilled:
      snapshot.orders?.unfulfilled === undefined
        ? null
        : snapshot.orders.unfulfilled,

    incoming:
      snapshot.orders?.incoming === undefined
        ? null
        : snapshot.orders.incoming,
  },

  comparison: {
  orders: {
    total:
      formatPctDiff(
        snapshot.comparison?.orders?.totalPctChange
      ),

    fulfilled:
      formatPctDiff(
        snapshot.comparison?.orders?.fulfilledPctChange
      ),

    unfulfilled:
      formatPctDiff(
        snapshot.comparison?.orders?.unfulfilledPctChange
      ),

    incoming:
      formatPctDiff(
        snapshot.comparison?.orders?.incomingPctChange
      ),
  },
},

  context: {
    ordersObserved:
      snapshot.context?.ordersObserved === undefined
        ? null
        : snapshot.context.ordersObserved,
  },

  totals: {
    revenueTotal:
      snapshot.totals?.revenueTotal === undefined
        ? null
        : snapshot.totals.revenueTotal,

    costTotal:
      snapshot.totals?.costTotal === undefined
        ? null
        : snapshot.totals.costTotal,
  },

  /**
   * ─────────────────────────────────────────
   * REVENUE OVERVIEW (FT2)
   * ─────────────────────────────────────────
   * Pure pass-through.
   * No computation. No inference.
   */
  revenue: {
    total:
      snapshot.revenue?.total === undefined
        ? null
        : snapshot.revenue.total,

    fulfilled:
      snapshot.revenue?.fulfilled === undefined
        ? null
        : snapshot.revenue.fulfilled,

    unfulfilled:
      snapshot.revenue?.unfulfilled === undefined
        ? null
        : snapshot.revenue.unfulfilled,
    },

  dataCoverage: {
    completenessPct:
      snapshot.dataCoverage?.completenessPct === undefined
        ? null
        : snapshot.dataCoverage.completenessPct,
  },

  visibility:
    snapshot.visibility === undefined
      ? null
      : snapshot.visibility,

  /**
   * Canonical ingestion presence (L1)
   * Presence-only. No inference.
   */
  ingestion:
    snapshot.ingestion === undefined
      ? null
      : snapshot.ingestion,

  /**
   * Temporal freshness (L1)
   * Classification only.
   */
  freshness:
    snapshot.freshness === undefined
      ? null
      : snapshot.freshness,

  /**
   * ─────────────────────────────────────────
   * POST-GROUNDING CONTEXT
   * ─────────────────────────────────────────
   */

  outcome:
    snapshot.outcome === undefined
      ? null
      : snapshot.outcome,

  trend:
    snapshot.trend === undefined
      ? null
      : snapshot.trend,

  /**
   * Revenue signal continuity (L1½)
   * Bypasses intelligence. Pass-through only.
   */
  revenueContinuity:
    snapshot.revenueContinuity === undefined
      ? null
      : snapshot.revenueContinuity,

  /**
   * ─────────────────────────────────────────
   * STRUCTURAL COHERENCE (ALIGNMENT)
   * ─────────────────────────────────────────
   */

  alignment:
    snapshot.alignment === undefined
      ? null
      : snapshot.alignment,

  trust:
    trust === undefined
      ? null
      : trust,
  };
}