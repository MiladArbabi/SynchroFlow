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

// AFTER
import { useState } from 'react';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
import { OrderDetailPanel } from '../../pages/orders/OrderDetailPanel';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {
  /**
   * SELECTED ORDER STATE
   * --------------------
   * Controls the OrderDetailPanel drawer.
   * null = panel closed. orderId = panel open for that order.
   */
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const snapshotQuery = useOrdersFt2Snapshot();

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
      />

      {/**
       * ORDER DETAIL PANEL (B-02, B-03)
       * --------------------------------
       * Right-side drawer — mounts at page level to overlay
       * the full FT2 surface without navigation.
       * onOrderSelect wired to OperationalSignalsSection
       * in a future pass once signal cards expose order IDs.
       */}
      <OrderDetailPanel
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </>
  );
}