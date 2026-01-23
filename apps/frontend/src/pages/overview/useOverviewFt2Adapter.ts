import type { OverviewModuleFT2DataProps } from '@lasyncro/overview';
import { OverviewFt2Snapshot } from './useOverviewSnapshot';

/**
 * mapOverviewFt2Props
 * ------------------
 * Canonical FT2 Overview adapter.
 *
 * This function is a **pure adapter**.
 *
 * HARD INVARIANTS (NON-NEGOTIABLE):
 * - No inference
 * - No computation
 * - No aggregation
 * - No lifecycle awareness
 * - No semantic translation
 * - No defaults other than `undefined → null`
 * - Deterministic output for the same input
 *
 * Mental model:
 * Backend FT2 snapshot → Read-only orientation surface
 *
 * The adapter is a pipe, not a brain.
 */
export function mapOverviewFt2Props(
  snapshot: OverviewFt2Snapshot
): OverviewModuleFT2DataProps {
  return {
    trust:
      snapshot.trust === undefined
        ? null
        : snapshot.trust,

    context: {
      ordersObserved:
        snapshot.context?.ordersObserved === undefined
          ? null
          : snapshot.context.ordersObserved,

      productsObserved:
        snapshot.context?.productsObserved === undefined
          ? null
          : snapshot.context.productsObserved,

      customersObserved:
        snapshot.context?.customersObserved === undefined
          ? null
          : snapshot.context.customersObserved,
    },

    snapshot: {
      orders:
        snapshot.snapshot?.orders === undefined
          ? null
          : snapshot.snapshot.orders,

      products:
        snapshot.snapshot?.products === undefined
          ? null
          : snapshot.snapshot.products,

      customers:
        snapshot.snapshot?.customers === undefined
          ? null
          : snapshot.snapshot.customers,
    },

    alignment:
      snapshot.alignment === undefined
        ? null
        : snapshot.alignment,
  };
}
