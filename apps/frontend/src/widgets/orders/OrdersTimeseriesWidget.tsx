// apps/frontend/src/widgets/orders/OrdersTimeseriesWidget.tsx

import React from 'react';
import Chart from 'react-apexcharts';
import { ORDERS_FT2_TIMESERIES } from 'charts/ft2ChartRegistry';

/**
 * OrdersTimeseriesPoint
 * ---------------------
 * Mirrors operational projection row.
 *
 * Source:
 * orders_operational_control_snapshot
 *
 * NOTE
 * ----
 * Widget must visualize operational pressure
 * rather than legacy order counts.
 */
export type OrdersTimeseriesPoint = {
  snapshot_date: string;
  constrained_orders: number | null;
  queue_awaiting_inventory: number | null;
  orders_at_sla_risk: number | null;
  revenue_blocked_inventory: number | null;
};

export interface OrdersTimeseriesWidgetProps {
  series: OrdersTimeseriesPoint[] | null;
}

/**
 * OrdersTimeseriesWidget (FT2)
 * ----------------------------
 * FACT visualization only.
 */
export default function OrdersTimeseriesWidget({
  series
}: OrdersTimeseriesWidgetProps) {
  if (series === null) {
    return <div data-testid="orders-timeseries-empty">—</div>;
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Chart
        type="line"
        height="100%"
        options={ORDERS_FT2_TIMESERIES}
        /**
         * Operational Pressure Timeline
         * -----------------------------
         * Multi-line visualization of operational constraints.
         */
        series={[
          {
            name: 'Inventory Constraints',
            data: series.map((p) => p.constrained_orders ?? 0),
          },
          {
            name: 'Awaiting Inventory',
            data: series.map((p) => p.queue_awaiting_inventory ?? 0),
          },
          {
            name: 'SLA Risk',
            data: series.map((p) => p.orders_at_sla_risk ?? 0),
          },
        ]}
      />
    </div>
  );
}
