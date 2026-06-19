// apps/frontend/src/pages/ft2-pages/OrdersFT2Page.tsx
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
//
// onPriorityFlag (Change 2 · Sprint 3):
// - Fires POST /api/v1/wms/orders/:orderId/priority for each selected id
// - Parallel via Promise.all — order-independent
// - Invalidates ['wms','order-pool'] so ReleaseQueuePage reflects priority
//   flags immediately when the navigation lands there

import { useState, useCallback } from 'react';
import { useSetPriority } from '../wms/useOrderPool';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
import { OrderDetailPanel } from '../../pages/orders/OrderDetailPanel';
import { useOrdersOperatorSummary } from '../orders/useOrdersOperatorSummary';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { OrderCapBanner } from '../../components/OrderCapBanner';
import { axiosInstance } from 'api/axiosConfig';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const snapshotQuery = useOrdersFt2Snapshot();
  const operatorSummaryQuery = useOrdersOperatorSummary();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const setPriority = useSetPriority();

  /**
   * onPriorityFlag
   * --------------
   * Receives the array of selected lasyncro_order_ids from OrdersModuleFT2.
   * Fires one POST per id in parallel — backend is idempotent per order.
   * On resolution the module navigates to /orders/pool (handled in module).
   */
  const onPriorityFlag = useCallback(
    async (orderIds: string[], flagged: boolean) => {
      await Promise.all(
        orderIds.map(orderId => setPriority.mutateAsync({ orderId, flagged }))
      );
    },
    [setPriority]
  );

  if (!snapshotQuery.data) {
    return <div>Loading orders insights…</div>;
  }

  const decision = snapshotQuery.data.decision;
  const operationalControl = snapshotQuery.data.operationalControl!;
  const headerProps = mapOrdersFt2Props(snapshotQuery.data, decision);

  if (__DEV__) {
    console.debug('[OrdersFT2Page] rendering OrdersModuleFT2', headerProps);
  }

  return (
    <>
            <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <OrderCapBanner />
      <OrdersModuleFT2
        {...headerProps}
        operationalControl={operationalControl}
        operatorSummary={operatorSummaryQuery.data ?? null}
        currency={{ displayCurrency, locale, rates }}
        onPriorityFlag={onPriorityFlag}
        onExport={async () => {
          try {
            const res = await axiosInstance.post('/api/v1/exports/orders', {}, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `lasyncro-orders-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          } catch {
            console.error('[Orders] export failed');
          }
        }}
      />
      <OrderDetailPanel
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </>
  );
}