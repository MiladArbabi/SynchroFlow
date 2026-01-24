// apps/frontend/src/pages/OrdersFT2Page.tsx
//
// OrdersFT2Page
// -------------
// FT2-only Orders observability surface.
//
// HARD CONTRACT:
// - MUST render OrdersModuleFT2 only
// - MUST NOT render FT1 modules
// - MUST NOT infer lifecycle
// - MUST assume FT2 routing is authoritative

// apps/frontend/src/pages/OrdersFT2Page.tsx

import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { useOrdersFt2Timeseries } from '../orders/useOrdersFt2Timeseries';
import { useOrdersFt2Distribution } from '../orders/useOrdersFt2Distribution';

import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
import { mapOrdersFt2TimeseriesProps } from '../orders/useOrdersFt2TimeseriesAdapter';
import { mapOrdersFt2DistributionProps } from '../orders/useOrdersFt2DistributionAdapter';
import OrdersDistributionWidget from 'widgets/orders/OrdersDistributionWidget';
import OrdersTimeseriesWidget from 'widgets/orders/OrdersTimeseriesWidget';

import { useState } from 'react';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { FT2DateRangeBar } from '@lasyncro/ui-ft2';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_30_days',
    from: null,
    to: null,
  });

  const snapshotQuery = useOrdersFt2Snapshot(range);
  const timeseriesQuery = useOrdersFt2Timeseries(range);
  const distributionQuery = useOrdersFt2Distribution(range);

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[OrdersFT2Page] awaiting FT2 snapshot');
    }
    return <div>Loading orders insights…</div>;
  }

  const headerProps = mapOrdersFt2Props(snapshotQuery.data);
  const timeseriesProps = mapOrdersFt2TimeseriesProps(timeseriesQuery.data);
  const distributionProps = mapOrdersFt2DistributionProps(distributionQuery.data);

  if (__DEV__) {
    console.debug('[OrdersFT2Page] rendering OrdersModuleFT2', headerProps);
    console.debug('[OrdersFT2Page] rendering OrdersTimeseriesWidget', timeseriesProps);
    console.debug('[OrdersFT2Page] distribution', distributionProps);
  }

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />

      <OrdersModuleFT2
        {...headerProps}
        timeseries={<OrdersTimeseriesWidget {...timeseriesProps} />}
        distribution={<OrdersDistributionWidget {...distributionProps} />}
      />
    </>
  );
}