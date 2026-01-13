// apps/frontend/src/pages/orders/useOrdersFt2TimeseriesAdapter.ts

import type {
  OrdersFt2TimeseriesSnapshot,
} from './useOrdersFt2Timeseries';

import type {
  OrdersTimeseriesWidgetProps,
} from 'widgets/orders/OrdersTimeseriesWidget';

/**
 * mapOrdersFt2TimeseriesProps
 * --------------------------
 * Pure FT2 adapter.
 *
 * Rules:
 * - undefined → null only
 * - No computation
 * - No reshaping semantics
 * - Deterministic
 */
export function mapOrdersFt2TimeseriesProps(
  snapshot: OrdersFt2TimeseriesSnapshot | undefined
): OrdersTimeseriesWidgetProps {
  if (!snapshot || snapshot.series === undefined) {
    return { series: null };
  }

  return {
    series: snapshot.series ?? null,
  };
}