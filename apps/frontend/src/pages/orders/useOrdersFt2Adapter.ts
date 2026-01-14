// apps/frontend/src/pages/orders/useOrdersFt2Adapter.ts

import type { OrdersModuleFT2DataProps } from '@lasyncro/order-nexus';

/**
 * OrdersFt2Snapshot
 * -----------------
 * This type represents the exact shape of the backend-provided
 * FT2 snapshot for OrderNexus.
 *
 * IMPORTANT:
 * - This is NOT an intelligence object.
 * - This is NOT guaranteed to be complete.
 * - Fields may be undefined, null, or partially present.
 *
 * The adapter's job is ONLY to:
 * - Normalize `undefined → null`
 * - Preserve values exactly as received
 * - Enforce a shape-stable FT2 UI contract
 *
 * The adapter MUST NOT:
 * - Infer
 * - Compute
 * - Derive
 * - Rename semantics
 * - Backfill defaults
 */
type OrdersFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
    ordersObserved?: number | null;
  };

  totals?: {
    revenueTotal?: number | null;
    costTotal?: number | null;
    currency?: string | null;
  };

  outcome?: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage?: {
    completenessPct?: number | null;
  };
};

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
      period: snapshot.context?.period ?? { from: '', to: '' },

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
  };
}