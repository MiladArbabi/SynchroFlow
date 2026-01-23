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
  snapshot: OrdersFt2Snapshot
): OrdersModuleFT2DataProps {
  return {
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

      currency:
        snapshot.totals?.currency === undefined
          ? null
          : snapshot.totals.currency,
    },

    outcome:
      snapshot.outcome === undefined
        ? null
        : snapshot.outcome,

    trend:
      snapshot.trend === undefined
        ? null
        : snapshot.trend,

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

    alignment:
      snapshot.alignment === undefined
        ? null
        : snapshot.alignment,
  };
}