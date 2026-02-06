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
    orders: {
      active:
        snapshot.orders?.active === undefined
          ? null
          : snapshot.orders.active,

      fulfilled:
        snapshot.orders?.fulfilled === undefined
          ? null
          : snapshot.orders.fulfilled,

      added:
        snapshot.orders?.added === undefined
          ? null
          : snapshot.orders.added,
    },

    returns: {
      returnedRevenue:
        snapshot.refunds?.returnedRevenue === undefined
          ? null
          : snapshot.refunds.returnedRevenue,

      returnedUnits:
        snapshot.refunds?.returnedUnits === undefined
          ? null
          : snapshot.refunds.returnedUnits,

      affectedOrders:
        snapshot.refunds?.affectedOrders === undefined
          ? null
          : snapshot.refunds.affectedOrders,
    },

  /**
   * ─────────────────────────────────────────
   * REVENUE OVERVIEW (FT2 — OBSERVED ONLY)
   * ─────────────────────────────────────────
   * Contract:
   * - Pure passthrough
   * - Availability-based only
   * - No execution semantics
   */
  revenue: {
    totalSales:
      snapshot.revenue?.totalSales === undefined
        ? null
        : snapshot.revenue.totalSales,

    earned:
      snapshot.revenue?.earned === undefined
        ? null
        : snapshot.revenue.earned,

    /**
     * Pending revenue (FT2)
     * --------------------
     * Availability-based only.
     *
     * NOTE:
     * This value may include revenue without execution certainty
     * depending on backend execution coverage.
     *
     * This adapter MUST NOT reinterpret or normalize this value.
     */
    pending:
      snapshot.revenue?.pending === undefined
        ? null
        : snapshot.revenue.pending,

    blocked:
      snapshot.revenue?.blocked === undefined
        ? null
        : snapshot.revenue.blocked,

    executionCoverage:
      snapshot.revenue?.executionCoverage === undefined
        ? null
        : snapshot.revenue.executionCoverage
  },

  comparison: {
    orders: {
      fulfilled:
        formatPctDiff(
          snapshot.comparison?.orders?.fulfilledPctChange
        ),

        incoming:
          formatPctDiff(
            snapshot.comparison?.orders?.incomingPctChange
          ),
    },
  },

  obligations:
    snapshot.obligations === undefined
      ? null
      : snapshot.obligations,

  /**
   * Revenue signal continuity (L1½)
   * Bypasses intelligence. Pass-through only.
   */
  revenueContinuity:
    snapshot.revenueContinuity === undefined
      ? null
      : snapshot.revenueContinuity,

  trust: trust ?? null,
  };
}