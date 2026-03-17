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

  /**
   * PROJECTION INTEGRITY CHECK
   * --------------------------
   * Ensures backend projection schema is intact.
   * Prevents silent UI corruption if API changes.
   */
  if (snapshot?.series?.length) {
    const row = snapshot.series[0];

    /**
     * Mathcing the Operational Pressure contract
     */
    const requiredFields = [
      'snapshot_date',
      'queue_awaiting_inventory',
      'orders_at_sla_risk',
      'revenue_blocked_inventory',
    ];

    const missing = requiredFields.filter((f) => !(f in row));

    if (missing.length > 0) {
      console.error('[FT2][OrdersTimeseriesAdapter] Projection schema mismatch', {
        missing,
        row,
      });

      return { series: null };
    }
  }

  /**
   * Adapter instrumentation
   * -----------------------
   * Provides visibility into timeseries ingestion.
   */
  if (import.meta.env.DEV) {
    console.debug('[FT2][OrdersTimeseriesAdapter] series rows', snapshot.series.length);
  }

  return {
    series: snapshot.series ?? null,
  };
}