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

import { OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOrdersFt2Snapshot } from './orders/useOrdersFt2Snapshot';
import { mapOrdersFt2Props } from './orders/useOrdersFt2Adapter';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {
  const snapshotQuery = useOrdersFt2Snapshot(true);

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[OrdersFT2Page] awaiting FT2 snapshot');
    }
    return <div>Loading orders insights…</div>;
  }

  const props = mapOrdersFt2Props(snapshotQuery.data);

  if (__DEV__) {
    console.debug('[OrdersFT2Page] rendering OrdersModuleFT2', props);
  }

  return <OrdersModuleFT2 {...props} />;
}