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
import useConfig from 'hooks/useConfig';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { ExportDrawer } from 'components/ExportDrawer';
import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';
import { Box } from '@mui/system';
import { Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone, LiveBinActivity, LocationPulse } from '@lasyncro/shared/ui';
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
  //
  // D2C — SHELL READINESS: `data ?? []` alone cannot distinguish "query
  // hasn't resolved yet" from "resolved, no current episodes" — both would
  // otherwise collapse to the same `[]`. Only project on isSuccess;
  // pending/error stay `null` (canonical lifecycle UNRESOLVED) rather than
  // silently reading as "confirmed clear". No new clock/readiness state is
  // introduced — this reads react-query's own existing result shape.
  const operationalEpisodesQuery = useOperationalEpisodes();
  const operationalEpisodeVisuals = operationalEpisodesQuery.isSuccess
    ? projectOrdersOperationalVisuals(
        projectOrdersOperationalEpisodes(operationalEpisodesQuery.data ?? [])
      )
    : null;
  const { displayCurrency, locale, tier } = useEntitlements();
  // SCREEN-ARCH — Order health withdraws while the topnav Ops Console is
  // open. Read-only: the topnav trigger remains the sole owner.
  const { state: { isOpsConsoleOpen } } = useConfig();
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

  /**
   * C2A — hover/pinned plates reuse IsometricCanvas's shared grammar. The
   * page only states Orders facts that the live payload actually locates
   * (picker positions and their batch phase); a bin with no Orders activity
   * has no plate and stays silent.
   */
  const orderLocationPulseByCode: Record<string, LocationPulse> = {};
  for (const [code, activity] of Object.entries(orderFloorActivity)) {
    const phase = [
      (activity.pickingCount ?? 0) > 0 ? 'Picking' : null,
      (activity.packingCount ?? 0) > 0 ? 'Packing' : null,
    ].filter(Boolean).join(' · ');
    const rows: LocationPulse['rows'] = [
      { label: 'Pickers here', value: String(activity.operatorCount ?? 0) },
    ];
    if (phase) rows.push({ label: 'Batch phase', value: phase, tone: 'muted' });
    if ((activity.staleCount ?? 0) > 0) {
      rows.push({
        label: `No scan in ${ordersLiveActivity.data?.staleThresholdMinutes ?? 15}m`,
        value: String(activity.staleCount),
        tone: 'warning',
      });
    }
    orderLocationPulseByCode[code] = { title: code, rows };
  }

  // C2D — pulse exists = Orders has something truthful to inspect there; no
  // pulse = warehouse context only (not a hover/selection target).
  const orderInspectableLocationCodes = new Set(Object.keys(orderLocationPulseByCode));

  const [selectedLocationCode, setSelectedLocationCode] = useState<string | null>(null);
  const selectedLocationHasOrderWork =
    selectedLocationCode != null && orderLocationPulseByCode[selectedLocationCode] != null;

  const activeOrderBatches = ordersLiveActivity.data?.activeBatches ?? [];
  const pickingBatchCount = activeOrderBatches.filter(b => b.status === 'picking').length;
  const packingBatchCount = activeOrderBatches.filter(b => b.status === 'packing').length;

  // C2A — one stable spatial slot across every entry state, mirroring
  // Overview's certified workspace grammar (OverviewFT2Page mapContent):
  // teaser → floor loading → floor error → no-floor setup → live map.
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
  } else if (floorPlanning.isLoading) {
    // Holds the slot at full size while floor geometry is resolved, so the
    // screen never flashes the setup state to a tenant with a placed floor.
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', borderRadius: '14px', overflow: 'hidden',
        border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
        p: '22px 24px', display: 'flex', flexDirection: 'column', gap: '12px',
        '@keyframes lsShimmer': {
          '0%': { opacity: 0.45 }, '50%': { opacity: 0.9 }, '100%': { opacity: 0.45 },
        },
      }}>
        <Box sx={{ width: 140, height: 14, borderRadius: '4px', bgcolor: 'var(--bg-3)', animation: 'lsShimmer 1.6s ease-in-out infinite' }} />
        <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gridTemplateRows: 'repeat(3,1fr)', gap: '12px', mt: '8px' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Box key={i} sx={{ borderRadius: '10px', bgcolor: 'var(--bg-2)', animation: 'lsShimmer 1.6s ease-in-out infinite', animationDelay: `${i * 0.12}s` }} />
          ))}
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
          Loading your orders floor…
        </Typography>
      </Box>
    );
  } else if (floorPlanning.isError) {
    // A failed floor request is not an unmapped floor — never tell a
    // configured merchant to map their floor when the service failed.
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', borderRadius: '14px', overflow: 'hidden',
        border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '16px', p: '40px', textAlign: 'center',
      }}>
        <Box sx={{
          width: 44, height: 44, borderRadius: '50%',
          border: '1px solid var(--critical-border)', bgcolor: 'var(--critical-ghost)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--critical-ink)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" />
          </svg>
        </Box>
        <Typography sx={{ fontSize: 21, fontFamily: 'Instrument Serif', color: 'var(--ink)' }}>
          We couldn't load your floor.
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 340 }}>
          The floor service didn't respond. Your orders are unaffected — nothing has changed in your warehouse.
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={() => floorPlanning.refetch()}
          sx={{
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: 12.5,
            fontWeight: 500, fontFamily: 'inherit', color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
            border: 'none', borderRadius: '8px', px: '20px', py: '10px', cursor: 'pointer',
            '&:hover': { opacity: 0.85 },
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
          }}
        >
          Retry
        </Box>
      </Box>
    );
  } else if (!hasPlacedFloor) {
    mapContent = (
      <Box sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: 420, height: '100%', bgcolor: 'var(--surface)',
        border: '0.5px solid var(--rule)', borderRadius: '14px', overflow: 'hidden',
      }}>
        <Box sx={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', textAlign: 'center', gap: '14px', p: '2.75rem 2rem',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--accent)',
              '@keyframes ov03Blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
              animation: 'ov03Blink 2.4s ease-in-out infinite',
            }} />
            <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Orders live map
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>
            Map your warehouse floor first
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)', maxWidth: 420, lineHeight: 1.65 }}>
            Place your zones and bins once, and this becomes a live view of where
            today's orders are moving — and where they are getting stuck.
          </Typography>
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {['Picker positions', 'Pick & pack by location'].map((chip) => (
              <Box key={chip} sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 12, fontWeight: 300, color: 'var(--ink-2)', border: '0.5px solid var(--rule)', borderRadius: '999px', px: '12px', py: '5px' }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--accent)' }} />
                {chip}
              </Box>
            ))}
          </Box>
          <Box
            component="button"
            type="button"
            onClick={() => navigate('/floor-planning?tab=setup&view=canvas')}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', px: '20px', py: '11px',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit', color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
              border: 'none', borderRadius: '8px', cursor: 'pointer', mt: '6px',
              '&:hover': { bgcolor: 'var(--accent-hover)' },
              '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
            }}
          >
            Map the floor
          </Box>
        </Box>
      </Box>
    );
  } else {
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: '14px', overflow: 'hidden', border: '0.5px solid var(--rule)',
      }}>
        <Box sx={{ flex: 1, minHeight: 360, minWidth: 0 }}>
          {/* No `occupancy` — stock levels are an Inventory question. This map
              answers where ORDER work is happening, from real operator
              positions and real batch phases only. */}
          <IsometricCanvas
            zones={floorZones}
            liveActivity={orderFloorActivity}
            locationPulseByCode={orderLocationPulseByCode}
            inspectableLocationCodes={orderInspectableLocationCodes}
            selectedLocationCode={selectedLocationCode}
            onSelect={setSelectedLocationCode}
            onPinnedClose={() => setSelectedLocationCode(null)}
            pinnedAction={selectedLocationHasOrderWork ? {
              label: 'Open order flow →',
              onClick: () => navigate('/orders/flow'),
            } : null}
            showLegend={false}
            showControls={false}
            showWarehouseContext
            enableHoverFocus
            disablePan
            autoFit
            fitPhysicalFloorFirst
            fitPadding={0.88}
          />
        </Box>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: '10px', px: '16px', py: '11px',
          borderTop: '0.5px solid var(--rule)', bgcolor: 'var(--bg)', flexShrink: 0,
        }}>
          {activeOrderBatches.length > 0 ? (
            <>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--confirm-ink)', flexShrink: 0 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                {pickingBatchCount > 0 && `${pickingBatchCount} picking`}
                {pickingBatchCount > 0 && packingBatchCount > 0 && ' · '}
                {packingBatchCount > 0 && `${packingBatchCount} packing`}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
              No active batches
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Box
            component="button"
            type="button"
            onClick={() => navigate('/orders/flow')}
            sx={{
              appearance: 'none', border: 'none', bgcolor: 'transparent', p: 0, fontFamily: 'inherit',
              fontSize: 12, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', flexShrink: 0,
              '&:hover': { opacity: 0.75 },
              '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
            }}
          >
            Open order flow →
          </Box>
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
        onOrderClick={(orderId) => setSelectedOrderId(orderId)}
        mapContent={mapContent}
        suppressOrderHealth={isOpsConsoleOpen}
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
