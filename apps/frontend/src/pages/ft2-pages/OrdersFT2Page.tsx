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

import { useState } from 'react';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
import { OrderDetailPanel } from '../../pages/orders/OrderDetailPanel';
import { useOrdersOperatorSummary } from '../orders/useOrdersOperatorSummary';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ModuleTabBar } from '../../components/ModuleTabBar';

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

  /**
   * OPERATOR SUMMARY
   * ----------------
   * Loads independently from the FT2 snapshot.
   * Page renders FT2 data immediately — operator data populates when ready.
   * Follows the Products module two-endpoint pattern.
   */
  const operatorSummaryQuery = useOrdersOperatorSummary();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  /**
   * PROGRESSIVE RENDER GUARD
   * ------------------------
   * Only block render if data is entirely absent.
   * isLoading with stale data → render with previous data.
   * error state → render with null-safe fallback in OrdersModuleFT2.
   * This mirrors the Products module pattern: operator surface
   * renders immediately, secondary data loads independently.
   */
  if (!snapshotQuery.data) {
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
      <ModuleTabBar tabs={[
        { id: 'intelligence', label: 'Intelligence', path: '/orders' },
        { id: 'fulfillment',  label: 'Fulfillment Queue', path: '/fulfillment' },
      ]} />
      <OrdersModuleFT2
        {...headerProps}
        operationalControl={operationalControl}
        operatorSummary={operatorSummaryQuery.data ?? null}
        currency={{ displayCurrency, locale, rates }}
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