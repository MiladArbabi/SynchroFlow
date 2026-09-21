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
import { useConstrainedOrders } from '../orders/useConstrainedOrders';
import { useOperationalEpisodes } from '../orders/useOperationalEpisodes';
import { projectOrdersOperationalEpisodes } from '../orders/ordersOperationalEpisodeProjection';
import { projectOrdersOperationalVisuals } from '../orders/ordersOperationalEpisodeVisual';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { ExportDrawer } from 'components/ExportDrawer';
import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';
import { Box } from '@mui/system';
import { Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone, LiveBinActivity } from '@lasyncro/shared/ui';
import { LiveMapTeaser } from 'components/LiveMapTeaser';
import { useCommercialAccess } from '../../runtime/commercialContext';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useOrdersLiveActivity } from '../wms/useWmsLiveActivity';

const __DEV__ = import.meta.env.DEV;

export default function OrdersFT2Page() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const handleCloseOrderDetail = useCallback(() => {
    setSelectedOrderId(null);
  }, []);
  const [modalTitle, setModalTitle] = useState('');
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalFooter, setModalFooter] = useState<ReactNode>(null);
  const snapshotQuery = useOrdersFt2Snapshot();
  const operatorSummaryQuery = useOrdersOperatorSummary();
  // Existing constrained-orders payload — feeds OrdersModuleFT2's
  // "Package returned" group, which is order_constraints truth and must not
  // depend on the SLA/aging population. Same endpoint/hook the Blocked
  // surface already uses; no new query.
  const constrainedQuery = useConstrainedOrders({ limit: 50 });
  // D2B — canonical operational-episode lifecycle (attention/verifying/
  // just_resolved), presented as NON-SPATIAL context in OrdersModuleFT2's
  // Live Intelligence rail only. D1 projection -> D2A visual, no second
  // projection/adapter here.
  const operationalEpisodesQuery = useOperationalEpisodes();
  const operationalEpisodeAggregates = projectOrdersOperationalEpisodes(
    operationalEpisodesQuery.data ?? []
  );
  const operationalEpisodeVisuals = projectOrdersOperationalVisuals(operationalEpisodeAggregates);
  const { displayCurrency, locale, tier } = useEntitlements();
  const { rates } = useExchangeRates();
  const bulkSetPriority = useBulkSetPriority();
  const navigate = useNavigate();

  /**
   * ORD-UX-01 — Orders Live Intelligence commercial + acquisition boundary.
   *
   * The canonical orders.live_map AccessDecision is the only authority. Never
   * reconstruct eligibility from a raw tier compare. isResolved keeps map
   * access false until the entitlement snapshot lands, so a Growth tenant never
   * flashes the teaser first.
   */
  const { decide, isResolved } = useCommercialAccess();
  const liveMapDecision = decide('orders.live_map');
  const hasMapAccess = isResolved && liveMapDecision.allowed;

  // A denied tenant must not ACQUIRE floor geometry either.
  const floorPlanning = useFloorPlanning(hasMapAccess);
  const floorZones: WarehouseZone[] = floorPlanning.data?.zones ?? [];

  // Same positioned-zone semantics as Overview and Inventory: rows exist on
  // every tenant (the bootstrapped WH-{shopId}-ROOT row), a floor does not.
  const hasPlacedFloor = floorZones.some(
    (z: WarehouseZone) => z.position_x != null && z.position_y != null
  );

  // Live operator activity is only drawable on a placed floor, so acquisition
  // follows both the decision and the floor.
  const ordersLiveActivity = useOrdersLiveActivity(hasMapAccess && hasPlacedFloor);

  /**
   * V1 map semantics: "where are today's orders moving or getting stuck?"
   *
   * Built ONLY from real attribution already in the live payload — pickerPositions
   * carry a real location_code, and activeBatches carry the phase. Nothing is
   * placed on the floor that the payload does not locate: no order-to-bin
   * inference, no inventory occupancy, no fabricated pack locations. Non-spatial
   * order problems stay in the right rail.
   */
  const batchStatusById = (ordersLiveActivity.data?.activeBatches ?? []).reduce<Record<string, string>>(
    (acc, b) => { acc[b.batch_id] = b.status; return acc; },
    {}
  );
  const staleThresholdMs =
    (ordersLiveActivity.data?.staleThresholdMinutes ?? 15) * 60 * 1000;

  const orderFloorActivity = (ordersLiveActivity.data?.pickerPositions ?? []).reduce<
    Record<string, LiveBinActivity>
  >((acc, p) => {
    const existing = acc[p.location_code];
    const status = batchStatusById[p.batch_id];
    const pickingCount = (existing?.pickingCount ?? 0) + (status === 'picking' ? 1 : 0);
    const packingCount = (existing?.packingCount ?? 0) + (status === 'packing' ? 1 : 0);
    const freshnessAt = Math.max(
      p.last_scan_at ? new Date(p.last_scan_at).getTime() : 0,
      new Date(p.batch_activity_at).getTime()
    );
    const isStale = Date.now() - freshnessAt > staleThresholdMs;

    acc[p.location_code] = {
      operatorCount: (existing?.operatorCount ?? 0) + 1,
      hasActivePick: true,
      pickingCount,
      packingCount,
      staleCount: (existing?.staleCount ?? 0) + (isStale ? 1 : 0),
      lastActivityAt: Math.max(existing?.lastActivityAt ?? 0, freshnessAt),
      status:
        pickingCount > 0 && packingCount === 0
          ? 'picking'
          : packingCount > 0 && pickingCount === 0
            ? 'packing'
            : undefined,
    };
    return acc;
  }, {});

  let mapContent: ReactNode;

  if (!hasMapAccess) {
    mapContent = (
      <LiveMapTeaser
        title="Orders live map"
        description="Watch today's orders move across your floor — who is picking what, where work is stalling, and which bins are holding the queue up."
        requiredTier={liveMapDecision.requiredTier ?? null}
        onUpgrade={() => navigate('/settings/billing')}
      />
    );
  } else if (hasPlacedFloor) {
    mapContent = (
      <Box sx={{
        minHeight: { xs: 420, lg: 460 }, height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: '14px', overflow: 'hidden', border: '0.5px solid var(--rule)',
      }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {/* No `occupancy` — stock levels are an Inventory question. This map
              answers where ORDER work is happening, from real operator
              positions and real batch phases only. */}
          <IsometricCanvas
            zones={floorZones}
            liveActivity={orderFloorActivity}
            showLegend={false}
            showControls={false}
            enableHoverFocus
            disablePan
            autoFit
            fitPhysicalFloorFirst
            fitPadding={0.88}
          />
        </Box>
      </Box>
    );
  } else {
    mapContent = (
      <Box sx={{
        minHeight: { xs: 420, lg: 460 }, height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        gap: 1, p: 3,
        borderRadius: '14px', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
      }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
          Map your warehouse floor first
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', maxWidth: 360, mb: 1.5 }}>
          Place your zones and bins once, and this becomes a live view of where
          today's orders are moving — and where they are getting stuck.
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={() => navigate('/floor-planning?tab=setup&view=canvas')}
          sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            px: '14px', py: '7px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
            '&:hover': { opacity: 0.88 },
          }}
        >
          Map the floor
        </Box>
      </Box>
    );
  }

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
      <Box sx={{ mt: 3, px: 2 }}>
      </Box>
      <OrdersModuleFT2
        {...headerProps}
        operationalControl={operationalControl}
        operatorSummary={operatorSummaryQuery.data ?? null}
        constrainedOrders={constrainedQuery.data?.data ?? null}
        operationalEpisodeVisuals={operationalEpisodeVisuals}
        currency={{ displayCurrency, locale, rates }}
        onPriorityFlag={onPriorityFlag}
        onOrderClick={(orderId) => setSelectedOrderId(orderId)}
        mapContent={mapContent}
        // §6 — Orders/Overview is specced as "Export → opens drawer with
        // format picker", same as Overview's Export brief). Keep this surface
        // focused on the canonical All Orders export; filtered variants remain
        // available through the export API rather than duplicate report cards.
        onExport={async () => setExportDrawerOpen(true)}
      />
      <ExportDrawer
        open={exportDrawerOpen}
        onClose={() => setExportDrawerOpen(false)}
        reportIds={['orders-all']}
      />
     <EntityDetailModal
        entityId={selectedOrderId}
        onClose={handleCloseOrderDetail}
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
              onClose={handleCloseOrderDetail}
            />
        )}
      </EntityDetailModal>
    </>
  );
}
