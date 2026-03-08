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

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {

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
   * Decision signals are now embedded in the FT2 snapshot.
   * No secondary API calls allowed.
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
    </>
  );
}