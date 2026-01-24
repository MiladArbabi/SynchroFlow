// apps/frontend/src/widgets/orders/OrdersDistributionWidget.tsx

import React from 'react';
import Chart from 'react-apexcharts';
import { ORDERS_FT2_DISTRIBUTION } from 'charts/ft2ChartRegistry';

export interface OrdersDistributionBucket {
  bucketStart: number;
  bucketEnd: number;
  count: number;
}

export interface OrdersDistributionWidgetProps {
  histogram: OrdersDistributionBucket[] | null;
}

/**
 * OrdersDistributionWidget (FT2)
 * ------------------------------
 * Shape-only distribution.
 */
export default function OrdersDistributionWidget({
  histogram
}: OrdersDistributionWidgetProps) {
  if (histogram === null || histogram.length === 0) {
    return <div data-testid="orders-distribution-empty">—</div>;
  }

  return (
    <Chart
      type="bar"
      height={80}
      options={ORDERS_FT2_DISTRIBUTION}
      series={[
        {
          name: 'Orders per range',
          data: histogram.map((b) => b.count)
        }
      ]}
    />
  );
}
