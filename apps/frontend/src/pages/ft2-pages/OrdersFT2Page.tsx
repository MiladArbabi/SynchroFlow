/* eslint-disable @typescript-eslint/no-unused-vars */
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
//
// onOrderClick (2026-06-28 — ORD-03, see entity-detail-modal-playbook.md §2):
// - Opens EntityDetailModal for the clicked order. Replaces the previous
//   OrderDetailPanel import, which was confirmed dead (its open trigger was
//   never wired anywhere — setSelectedOrderId was only ever called with
//   null). OrderDetailPanel.tsx was removed. OrderDetailPage.tsx removed 2026-07-11
//   (ISS-OD-01) — modal is now primary; PackDecisionHistory merged into modal body.
// - Modal merges useOrderDecision (constraint + recommended action) and
//   usePickExceptionsForOrder (NEW — per-exception audit trail, separate
//   concern from the order-level block, see that hook's file header).
// - MERGED (2026-07-11, ISS-OD-02): useOrderDetail content (line items, payment,
//   fulfillment, tracking, timeline, pack decisions) fully in modal body.
//   OrderDetailPage.tsx removed — modal is the single order detail surface.
import { useState, useCallback, ReactNode } from 'react';
import { EntityDetailModal } from '@lasyncro/shared/ui';
import { useBulkSetPriority } from '../wms/useOrderPool';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
import { useOrdersOperatorSummary } from '../orders/useOrdersOperatorSummary';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { OrderCapBanner } from '../../components/OrderCapBanner';
import { ExportDrawer } from 'components/ExportDrawer';
import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalFooter, setModalFooter] = useState<ReactNode>(null);
  const snapshotQuery = useOrdersFt2Snapshot();
  const operatorSummaryQuery = useOrdersOperatorSummary();
  const { displayCurrency, locale, tier } = useEntitlements();
  const { rates } = useExchangeRates();
  const bulkSetPriority = useBulkSetPriority();
  const onPriorityFlag = useCallback(
    // THREAD B (2026-06-30): consolidated from an N-call Promise.all loop
    // against the singular WMS endpoint to one call against the bulk
    // ON-01 endpoint, which now carries the same pool-membership guard.
    // `flagged` is currently always true here (Prioritize is a one-way
    // action in the UI) — kept as a no-op param for forward
    // compatibility, not wired to a deprioritise call yet.
    async (orderIds: string[], flagged: boolean) => {
      await bulkSetPriority.mutateAsync(orderIds);
    },
    [bulkSetPriority]
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
        onOrderClick={(orderId) => setSelectedOrderId(orderId)}
        // ORDM-01 FIX (2026-06-29): was a hardcoded blob-download bypassing
        // the established ExportDrawer pattern (see export_system_playbook.md
        // §6 — Orders/Overview is specced as "Export → opens drawer with
        // format picker", same as Overview's Export brief). 'orders-all' and
        // 'orders-blocked' report IDs already existed in exportReports.ts,
        // unused until now.
        onExport={async () => setExportDrawerOpen(true)}
      />
      <ExportDrawer
        open={exportDrawerOpen}
        onClose={() => setExportDrawerOpen(false)}
        userTier={tier}
        reportIds={['orders-all', 'orders-blocked']}
      />
     <EntityDetailModal
        entityId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        title={modalTitle}
        subtitle={modalSubtitle}
        maxWidth="md"
        footerActions={modalFooter}
      >
        {selectedOrderId && (
          <OrderDetailModalBody
            orderId={selectedOrderId}
            onTitleReady={setModalTitle}
            onSubtitleReady={setModalSubtitle}
            onNavigateToOrder={setSelectedOrderId}
            onFooterReady={setModalFooter}
            onPriorityFlag={onPriorityFlag}
          />
        )}
      </EntityDetailModal>
    </>
  );
}
