// apps/frontend/src/pages/orders/useOrdersFt2DistributionAdapter.ts

import type {
  OrdersFt2DistributionSnapshot,
} from './useOrdersFt2Distribution';

export type OrdersDistributionWidgetProps = {
  totalOrders: number | null;
  minOrderValue: number | null;
  medianOrderValue: number | null;
  maxOrderValue: number | null;
  histogram: {
    bucketStart: number;
    bucketEnd: number;
    count: number;
  }[] | null;
};

/**
 * mapOrdersFt2DistributionProps
 * -----------------------------
 * Pure FT2 adapter.
 *
 * Rules:
 * - undefined → null only
 * - No computation
 * - No interpretation
 * - Deterministic
 */
export function mapOrdersFt2DistributionProps(
  snapshot: OrdersFt2DistributionSnapshot | undefined
): OrdersDistributionWidgetProps {
  if (!snapshot) {
    return {
      totalOrders: null,
      minOrderValue: null,
      medianOrderValue: null,
      maxOrderValue: null,
      histogram: null,
    };
  }

  return {
    totalOrders:
      snapshot.totalOrders === undefined ? null : snapshot.totalOrders,
    minOrderValue:
      snapshot.minOrderValue === undefined ? null : snapshot.minOrderValue,
    medianOrderValue:
      snapshot.medianOrderValue === undefined ? null : snapshot.medianOrderValue,
    maxOrderValue:
      snapshot.maxOrderValue === undefined ? null : snapshot.maxOrderValue,
    histogram:
      snapshot.histogram === undefined ? null : snapshot.histogram,
  };
}