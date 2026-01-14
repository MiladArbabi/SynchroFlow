// apps/frontend/src/widgets/orders/OrdersTimeseriesWidget.tsx

import React from 'react';
import Chart from 'react-apexcharts';
import { ORDERS_FT2_TIMESERIES } from 'charts/ft2ChartRegistry';

export type OrdersTimeseriesPoint = {
  date: string;
  ordersObserved: number | null;
  revenueTotal: number | null;
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
        series={[
          {
            name: 'Orders',
            data: series.map((p) => p.ordersObserved ?? 0),
          },
        ]}
      />
    </div>
  );
}
