// apps/frontend/src/pages/orders/useOrdersFt2Adapter.ts
import type { OrdersModuleFT2DataProps } from '@lasyncro/order-nexus';
import { OrdersFt2Snapshot } from './useOrdersFt2Snapshot';

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
  decision: OrdersModuleFT2DataProps['decision']
): OrdersModuleFT2DataProps {

  return {
    decision,
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

      constrained:
        snapshot.orders?.constrained === undefined
          ? null
          : snapshot.orders.constrained,
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
  },

  obligations:
    snapshot.obligations === undefined
      ? null
      : snapshot.obligations
  };
}