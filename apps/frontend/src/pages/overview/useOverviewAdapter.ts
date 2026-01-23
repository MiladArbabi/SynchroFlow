/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/overview/useOverviewAdapter.ts
import type { OverviewModuleFT2DataProps } from '@lasyncro/overview';
import { OverviewFt2Snapshot } from './useOverviewSnapshot';

/**
 * mapOverviewFt2Props
 * ------------------
 * Canonical Overview FT2 adapter.
 *
 * HARD INVARIANTS:
 * - Pure function
 * - No inference
 * - No lifecycle awareness
 * - No defaults except `undefined → null`
 * - Deterministic for identical input
 */
export function mapOverviewFt2Props(
  snapshot: OverviewFt2Snapshot
): OverviewModuleFT2DataProps {
  return {
    trust:
      snapshot.trust === undefined || snapshot.trust === null
        ? null
        : {
            dataFreshness:
              (snapshot.trust as any).dataFreshness ?? null,

            syncCoverage:
              (snapshot.trust as any).syncCoverage ?? null,

            crossSourceConsistency:
              (snapshot.trust as any).crossSourceConsistency ?? null,

            trustEligible:
              (snapshot.trust as any).trustEligible ?? null,
          },

    context: {
      ordersObserved:
        (snapshot.snapshot as any)?.orders?.ordersObserved ?? null,

      productsObserved:
        (snapshot.snapshot as any)?.products?.productsObserved ?? null,

      customersObserved:
        (snapshot.snapshot as any)?.customers?.customersObserved ?? null,
    },

    snapshot: {
      orders:
        (snapshot.snapshot as any)?.orders === undefined
          ? null
          : {
              revenueTotal:
                (snapshot.snapshot as any)?.orders?.revenueTotal ?? null,

              currency:
                (snapshot.snapshot as any)?.orders?.currency ?? null,
            },

      products: null,
      customers: null,
    },

    alignment: null,
  };
}
