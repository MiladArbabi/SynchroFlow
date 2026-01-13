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
import OrdersTimeseriesWidget from 'widgets/orders/OrdersTimeseriesWidget';
import OrdersDistributionWidget from 'widgets/orders/OrdersDistributionWidget';

import { useOrdersFt2Snapshot } from './orders/useOrdersFt2Snapshot';
import { useOrdersFt2Timeseries } from './orders/useOrdersFt2Timeseries';
import { useOrdersFt2Distribution } from './orders/useOrdersFt2Distribution';

import { mapOrdersFt2Props } from './orders/useOrdersFt2Adapter';
import { mapOrdersFt2TimeseriesProps } from './orders/useOrdersFt2TimeseriesAdapter';
import { mapOrdersFt2DistributionProps } from './orders/useOrdersFt2DistributionAdapter';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {
  const snapshotQuery = useOrdersFt2Snapshot(true);
  const timeseriesQuery = useOrdersFt2Timeseries(snapshotQuery.isSuccess);
  const distributionQuery = useOrdersFt2Distribution(snapshotQuery.isSuccess);

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
      <OrdersModuleFT2 {...headerProps} />
      <OrdersTimeseriesWidget {...timeseriesProps} />
      <OrdersDistributionWidget {...distributionProps} />
    </>
  );
}