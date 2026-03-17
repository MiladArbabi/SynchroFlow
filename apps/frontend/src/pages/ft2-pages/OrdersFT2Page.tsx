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
import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
/**
 * Control Tower — Operational Pressure Timeline
 * ----------------------------------------------
 * Frontend visualization widget consuming
 * FT2 operational snapshot timeseries.
 */
import { useOrdersFt2Timeseries } from '../orders/useOrdersFt2Timeseries';
import { mapOrdersFt2TimeseriesProps } from '../orders/useOrdersFt2TimeseriesAdapter';
import { OperationalPressurePanel } from '../../widgets/orders/OperationalPressurePanel';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {

  const snapshotQuery = useOrdersFt2Snapshot();
  /**
   * Operational pressure timeline
   * -----------------------------
   * Historical projection snapshots used for
   * Control Tower pressure trend visualization.
   */
  const range: FT2DateRange = {
    preset: 'past_30_days',
    from: null,
    to: null,
  };

  const timeseriesQuery = useOrdersFt2Timeseries(range);
  const timeseries = mapOrdersFt2TimeseriesProps(timeseriesQuery.data);

  if (!snapshotQuery.isSuccess) {
    console.log('[AUDIT][snapshot]', {
      isSuccess: snapshotQuery.isSuccess,
      status: snapshotQuery.status,
      fetchStatus: snapshotQuery.fetchStatus,
      hasData: !!snapshotQuery.data,
    });

    return <div>Loading orders insights…</div>;
  }

  /**
   * FT2 DECISION SURFACE
   * --------------------
   * The FT2 snapshot is the canonical operational truth surface.
   *
   * Rules:
   * - The snapshot contains decision signals and operational control state.
   * - Fact endpoints (timeseries, distribution, coverage) may be queried
   *   by dedicated visualization components.
   *
   * Constraint:
   * - This page must NOT orchestrate additional APIs directly.
   * - Child components/hooks may query read-only fact surfaces.
   *
   * Rationale:
   * Prevents lifecycle orchestration in the page layer while still
   * allowing visualization of historical operational projections.
   */
  const decision = snapshotQuery.data.decision;
  const operationalControl = snapshotQuery.data.operationalControl;

  const headerProps = mapOrdersFt2Props(
    snapshotQuery.data,
    decision,
  );

  if (__DEV__) {
    console.debug('[OrdersFT2Page] rendering OrdersModuleFT2', headerProps);
  }

  return (
    <>
      <OrdersModuleFT2
        {...headerProps}
        operationalControl={operationalControl}
        timeseries={
         /**
         *  Freshness comes from raw query (adapter strips it)
         */
        <OperationalPressurePanel
          series={timeseries?.series ?? null}
          isStale={timeseriesQuery.data?.isStale}
          lastSnapshotDate={timeseriesQuery.data?.lastSnapshotDate}
        />
        }
      />
    </>
  );
}