// File: apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx
// Lines 1–12 (imports)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useOverviewModulesFt2Snapshot } from '../overview/useOverviewModulesFt2Snapshot';
import { useTrustFt2Snapshot } from '../trust/useTrustFt2Snapshot';
import { useMorningBriefSnapshot } from '../overview/useMorningBriefSnapshot';
import { OverviewModuleFT2 } from '@lasyncro/overview';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import { mapOverviewFt2Props } from 'pages/overview/useOverviewFt2Adapter';
import { useAuth } from 'contexts/AuthContext';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { ProfileCompletionBanner } from '../overview/ProfileCompletionBanner';
import { ExportDrawer } from 'components/ExportDrawer';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useWarehouseGridOccupancy } from '../floor-planning/useWarehouseGrid';
import { useOrderPool } from '../wms/useOrderPool';
import { useWmsLiveActivity } from '../wms/useWmsLiveActivity';
import type { SyntheticStation, LiveBinActivity, WarehouseZone, LocationPulse } from '@lasyncro/shared/ui';
import { sendEvent } from 'analytics/adapter';
import { useIdleAlerts } from '../../hooks/useIdleAlerts';
import { useProblemCenter } from '../problem-center/useProblemCenter';

const LIVE_MAP_TEASER_DISMISS_KEY = 'overview-live-map-teaser-dismissed';

function teaserZone(
  locationCode: string,
  type: WarehouseZone['type'],
  parentLocationCode: string | null,
  x: number,
  y: number,
  width: number,
  depth: number,
  rackLevels: number | null,
  zoneType: string
): WarehouseZone {
  return {
    location_code: locationCode,
    type,
    parent_location_code: parentLocationCode,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: x,
    position_y: y,
    width,
    depth,
    orientation: 0,
    rack_levels: rackLevels,
    zone_type: zoneType,
    last_printed_at: null,
    warehouse_name: type === 'warehouse' ? 'Preview warehouse' : null,
  };
}

const LIVE_MAP_TEASER_ZONES: WarehouseZone[] = [
  teaserZone('PREVIEW', 'warehouse', null, 0, 0, 7, 6, null, 'storage'),

  teaserZone('A', 'lane', 'PREVIEW', 0.7, 0.6, 3.3, 0.8, null, 'pick'),
  teaserZone('A-1', 'bin', 'A', 0.8, 1.1, 0.9, 0.5, 3, 'pick'),
  teaserZone('A-2', 'bin', 'A', 1.85, 1.1, 0.9, 0.5, 3, 'pick'),
  teaserZone('A-3', 'bin', 'A', 2.9, 1.1, 0.9, 0.5, 3, 'pick'),

  teaserZone('B', 'lane', 'PREVIEW', 0.7, 3, 3.3, 0.8, null, 'pick'),
  teaserZone('B-1', 'bin', 'B', 0.8, 3.5, 0.9, 0.5, 3, 'pick'),
  teaserZone('B-2', 'bin', 'B', 1.85, 3.5, 0.9, 0.5, 3, 'pick'),
  teaserZone('B-3', 'bin', 'B', 2.9, 3.5, 0.9, 0.5, 3, 'pick'),

  teaserZone('PACK', 'bin', 'PREVIEW', 5, 1.1, 1.3, 1.1, 1, 'pack'),
  teaserZone('RECEIVE', 'bin', 'PREVIEW', 5, 3.4, 1.3, 1.1, 1, 'receive'),
];

const LIVE_MAP_TEASER_OCCUPANCY = {
  'A-1': { on_hand_quantity: 5 },
  'A-2': { on_hand_quantity: 18 },
  'A-3': { on_hand_quantity: 27 },
  'B-1': { on_hand_quantity: 8 },
  'B-2': { on_hand_quantity: 20 },
  'B-3': { on_hand_quantity: 29 },
};

function LiveMapUpgradeTeaser({ onUpgrade }: { onUpgrade: () => void }) {
  const [visible, setVisible] = useState(
    () => window.sessionStorage.getItem(LIVE_MAP_TEASER_DISMISS_KEY) !== '1'
  );

  useEffect(() => {
    if (!visible) return;

    sendEvent('upgrade_prompt.shown', {
      requiredTier: 'growth',
      featureName: 'Overview live operations map',
      mode: 'teaser',
      surface: 'overview',
    });
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    window.sessionStorage.setItem(LIVE_MAP_TEASER_DISMISS_KEY, '1');
    sendEvent('upgrade_prompt.dismissed', {
      requiredTier: 'growth',
      featureName: 'Overview live operations map',
      surface: 'overview',
    });
    setVisible(false);
  };

  const upgrade = () => {
    sendEvent('upgrade_prompt.clicked', {
      requiredTier: 'growth',
      featureName: 'Overview live operations map',
      surface: 'overview',
    });
    onUpgrade();
  };

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: 126,
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
        px: { xs: 2, sm: 2.5 },
        py: 2,
        bgcolor: 'var(--surface)',
        border: '0.5px solid var(--rule)',
        borderRadius: '14px',
        overflow: 'hidden',
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: { xs: 'none', sm: 'block' },
          position: 'relative',
          flex: '0 0 220px',
          height: '108px',
          bgcolor: 'var(--bg-2)',
          border: '0.5px solid var(--rule)',
          borderRadius: '9px',
          overflow: 'hidden',
          pointerEvents: 'none',
          opacity: 0.82,
          '& svg text': {
            display: 'none',
          },
        }}
      >
        <IsometricCanvas
        zones={LIVE_MAP_TEASER_ZONES}
        occupancy={LIVE_MAP_TEASER_OCCUPANCY}
        showLegend={false}
        showControls={false}
        disablePan
        autoFit
        fitPhysicalFloorFirst
        fitPadding={0.88}
        />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            mb: 0.5,
          }}
        >
          Available on Growth
        </Typography>

        <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', mb: 0.5 }}>
          See your warehouse move in real time
        </Typography>

        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Follow picks, stock pressure and blocked work on one live floor.
        </Typography>
      </Box>

      <Box
        component="button"
        onClick={upgrade}
        sx={{
          flexShrink: 0,
          px: 1.75,
          py: 0.875,
          bgcolor: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: '7px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          '&:hover': { opacity: 0.88 },
        }}
      >
        See Growth plan →
      </Box>

      <Box
        component="button"
        aria-label="Dismiss live map upgrade"
        onClick={dismiss}
        sx={{
          position: 'absolute',
          top: 8,
          right: 10,
          bgcolor: 'transparent',
          color: 'var(--ink-4)',
          border: 'none',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          p: 0.5,
          '&:hover': { color: 'var(--ink)' },
        }}
      >
        ×
      </Box>
    </Box>
  );
}

export default function OverviewPageFT2() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [forceRefresh, setForceRefresh] = useState(false);
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);

  const overviewModules = useOverviewModulesFt2Snapshot(undefined, !authLoading);
  const trust = useTrustFt2Snapshot(!authLoading);
  const morningBrief = useMorningBriefSnapshot(forceRefresh, !authLoading);

  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';
  const { displayCurrency, tier, hasResolved: entitlementsResolved } = useEntitlements();

  // Map data — all hooks unconditional (Rules of Hooks); data ignored when tier doesn't qualify.
  // Occupancy deferred until zones are loaded (enabled guard) to avoid a redundant request
  // on first paint. Per overview-live-map-playbook.md §3 and §4.
  // OV-ENTRY-001: hasMapTier must be false until entitlements resolve.
  // Prevents premature triage-layout flash while /api/v1/entitlements is in flight.
  const hasMapTier = entitlementsResolved && (tier === 'scale' || tier === 'growth');
  const floorPlanning = useFloorPlanning();
  const zones = floorPlanning.data?.zones ?? [];
  // OV-34: a floor exists only when at least one zone carries geometry — not
  // when rows merely exist. Every shop is bootstrapped with WH-{shopId}-ROOT
  // (auth.controller.ts:83 on signup, integration.controller.ts:798 on Shopify
  // install) with null position_x/position_y, so zones.length was 1 on a
  // never-configured tenant while IsometricCanvas filtered that row out of
  // positionedZones and painted an empty SVG. Mirrors IsometricCanvas.tsx:508
  // exactly so the gate and the canvas can never disagree about "has a floor".
  const hasPlacedFloor = zones.some(
    (z: WarehouseZone) => z.position_x != null && z.position_y != null
  );
  const occupancyQuery = useWarehouseGridOccupancy(hasMapTier && hasPlacedFloor);
  const idleAlerts = useIdleAlerts(hasMapTier && hasPlacedFloor);
  // useOrderPool (GET /api/v1/wms/order-pool, 30s poll) feeds the inbound apron:
  // eligible_order_count → bar height, summary.blocked_count → red sub-bar.
  // Semantics: orders waiting to be released to the floor, not yet released.
  // Consumed by the `stations` prop below → IsometricCanvas (OV-13).
  const orderPool = useOrderPool();

  // OV-41: unresolved physical problems stay attached to their recorded
  // problem_bin_location. Null means unknown — never invent a floor location.
  const problemCenter = useProblemCenter(
    hasMapTier && hasPlacedFloor,
    15_000
  );
  const problemTasks = problemCenter.data?.tasks ?? [];
  const problemByLocation = problemTasks.reduce<Record<string, number>>(
    (acc, task) => {
      if (!task.problem_bin_location) return acc;
      acc[task.problem_bin_location] =
        (acc[task.problem_bin_location] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const problemTaskTotal = problemTasks.length;
  const unlocatedProblemTaskTotal = problemTasks.filter(
    task => !task.problem_bin_location
  ).length;

  // Live activity — picker positions from pick_scan_log, 15s poll.
  // Disabled for non-scale tenants — avoids unnecessary polling.
  const liveActivityQuery = useWmsLiveActivity(hasMapTier);
  const activeBatches = liveActivityQuery.data?.activeBatches ?? [];
    // OV-152: unify visible warehouse warnings with the Overview headline.
  // Unknown prevents positive messaging while relevant queries are loading
  // or failed; disabled map-only sources do not block non-map tiers.
  // OV-34: gated on placed geometry, not row count — an unconfigured tenant
  // has no operational map and must not suppress non-map warning sources.
  const operationalMapEnabled = hasMapTier && hasPlacedFloor;

  const operationalWarningsUnresolved =
    !entitlementsResolved ||
    (hasMapTier && (floorPlanning.isLoading || floorPlanning.isError)) ||
    (
      operationalMapEnabled &&
      (
        idleAlerts.isLoading ||
        idleAlerts.isError ||
        orderPool.isPending ||
        orderPool.isError
      )
    );

  const operationalWarningState: 'clear' | 'warning' | 'unknown' =
    operationalWarningsUnresolved
      ? 'unknown'
      : operationalMapEnabled &&
          (
            idleAlerts.alerts.length > 0 ||
            (orderPool.data?.summary?.blocked_count ?? 0) > 0
          )
        ? 'warning'
        : 'clear';
  // batch_id -> status, so pickerPositions (which only carry batch_id) can
  // resolve which phase is happening at their bin. See playbook §6.4 (OV-14).
  const batchStatusById = activeBatches.reduce<Record<string, 'picking' | 'packing'>>(
    (acc, b) => { acc[b.batch_id] = b.status; return acc; },
    {}
  );
  // OV-132/OV-153: staleness is graded here, not filtered server-side. An
  // operator who stopped moving is the case a merchant most needs to see — the
  // old 4-hour window hid exactly that. The latest legitimate scan or batch
  // activity timestamp is authoritative; batch_activity_at is never null on a
  // live batch.
  const staleThresholdMs =
    (liveActivityQuery.data?.staleThresholdMinutes ?? 15) * 60 * 1000;

    const liveActivity = liveActivityQuery.data?.pickerPositions.reduce<Record<string, LiveBinActivity>>(
    (acc, p) => {
      const existing = acc[p.location_code];
      const status = batchStatusById[p.batch_id];
      const pickingCount =
        (existing?.pickingCount ?? 0) + (status === 'picking' ? 1 : 0);
      const packingCount =
        (existing?.packingCount ?? 0) + (status === 'packing' ? 1 : 0);
      // OV-153: both clocks represent legitimate operator activity. Claims and
      // confirmed scans are the only real-tenant writers; the guarded reviewer
      // worker advances only batch activity because scan logs are immutable.
      // Using the latest clock keeps that tenant fresh without allowing an old
      // position scan to override newer batch activity.
      const freshnessAt = Math.max(
        p.last_scan_at ? new Date(p.last_scan_at).getTime() : 0,
        new Date(p.batch_activity_at).getTime()
      );
      const isStale =
        Date.now() - freshnessAt > staleThresholdMs;

      acc[p.location_code] = {
        operatorCount: (existing?.operatorCount ?? 0) + 1,
        hasActivePick: true,
        pickingCount,
        packingCount,
        staleCount: (existing?.staleCount ?? 0) + (isStale ? 1 : 0),
        // OV-HOVER-02: keep the newest clock across operators sharing a bin.
        lastActivityAt: Math.max(existing?.lastActivityAt ?? 0, freshnessAt),
        // OV-136: phase is homogeneous only when exactly one phase is present.
        status:
          pickingCount > 0 && packingCount === 0
            ? 'picking'
            : packingCount > 0 && pickingCount === 0
              ? 'packing'
              : undefined,
      };

      return acc;
    },
    {}
  );

  // Floor-wide batch summary for the footer strip — real activeBatches data
  // that was previously fetched and discarded. See playbook §6.1 (OV-14).
  const pickingBatches = activeBatches.filter(b => b.status === 'picking');
  const packingBatches = activeBatches.filter(b => b.status === 'packing');
  const batchUnitsPicked = activeBatches.reduce((sum, b) => sum + b.picked_lines, 0);
  const batchUnitsTotal = activeBatches.reduce((sum, b) => sum + b.total_units, 0);
  const batchProgressPct = batchUnitsTotal > 0 ? Math.round((batchUnitsPicked / batchUnitsTotal) * 100) : null;
  const packQueueCount = packingBatches.reduce(
    (sum, b) => sum + Math.max(0, b.total_units - b.units_packed),
    0
  );
  const awaitingPackCount = liveActivityQuery.data?.awaitingPackUnits ?? 0;
  // OV-129: per-bin pending stow → map badges. The flat stowPressure.pending_count
  // is anchored to a hardcoded 'RECEIVE-1' that usually holds no stow tasks.
  const stowPending = (liveActivityQuery.data?.stowPressure.by_location ?? []).reduce<Record<string, number>>(
    (acc, s) => { acc[s.location_code] = s.pending_units; return acc; },
    {}
  );
  // OV-129d: floor-wide total for the marker key. Summed from by_location
  // UNITS — deliberately not stowPressure.pending_count, which counts TASKS.
  // Mixing the two would print a total that doesn't reconcile with the badges.
  const stowPendingTotal = (liveActivityQuery.data?.stowPressure.by_location ?? [])
    .reduce((sum, s) => sum + s.pending_units, 0);
  // OV-131: units physically at a dock → receive badge.
  const receiveAtDock = (liveActivityQuery.data?.receiveAtDock ?? []).reduce<Record<string, number>>(
    (acc, r) => { acc[r.location_code] = r.units; return acc; },
    {}
  );
  const receiveAtDockTotal = (liveActivityQuery.data?.receiveAtDock ?? [])
    .reduce((sum, r) => sum + r.units, 0);

  // Inbound apron — order pool count + constrained (blocked) sub-stack.
  // OV-157: outbound apron no longer waits on useLiveCapacity — the counts
  // come from useWmsLiveActivity, already on this page. IsometricCanvas has
  // always placed side:'outbound' on the left rail (stationPlacements :612);
  // nothing was missing but the station itself.
  const shippedToday = liveActivityQuery.data?.shippedToday ?? 0;
  const packedNotShipped = liveActivityQuery.data?.packedNotShipped ?? 0;

  // OV-40: one block per pipeline stage, ranked by distance from the floor.
  // The single-block-per-rail design packed two disjoint stages into one
  // volume separated only by colour — and this embed passes showLegend={false},
  // so nothing on screen explained that red meant blocked. A merchant read
  // "Order Pool · 3" on a red block while the pool was actually empty.
  //
  // Rail grammar (see playbook §5): unlocated work waits at the threshold,
  // located work appears where it is. Rank ascends outward from the slab, so
  // the map reads right-to-left as the order's journey:
  //   blocked (2) -> pool (1) -> [floor] -> shipped (1) -> staged (2)
  //
  // OUTBOUND-CONSOLIDATE-01: outbound state belongs on the ship zone the
  // merchant actually drew, not duplicated on a rail beside it. Binding a
  // workflow stage to a declared zone_type is what zone types are for —
  // stowPending and receiveAtDock already do exactly this.
  //
  // Only an unambiguous single ship zone claims outbound. With several, no
  // data attributes an order to one of them, and a first-match heuristic
  // would invent that attribution (see OV-146). With none, the merchant has
  // nowhere to put it. Both cases keep the rail.
  const shipZones = zones.filter(
    z => z.type === 'bin' && z.zone_type === 'ship' && z.active &&
         z.position_x != null && z.position_y != null
  );
  const outboundZoneCode = shipZones.length === 1 ? shipZones[0].location_code : null;

  // Zero-count stages are omitted by IsometricCanvas rather than drawn empty,
  // so the rail only ever shows stages holding work.
  const allStations: SyntheticStation[] = hasMapTier ? [
    {
      id: 'blocked',
      label: 'Blocked',
      side: 'inbound',
      rank: 2,
      count: orderPool.data?.summary?.blocked_count ?? 0,
      tone: 'critical',
      // Wider, lower footprint — Ive/consortium: form carries state. Blocked
      // work is settled and inert; it is not about to move.
      footprint: { tw: 1.8, td: 0.9 },
      deepLink: '/order-flow',
    },
    {
      id: 'pool',
      label: 'Order Pool',
      side: 'inbound',
      rank: 1,
      count: orderPool.data?.eligible_order_count ?? 0,
      // Narrower, taller — queued and imminent, next onto the floor.
      footprint: { tw: 1.2, td: 0.6 },
      deepLink: '/order-flow',
    },
    {
      id: 'staged',
      label: 'Awaiting pickup',
      side: 'outbound',
      rank: 2,
      count: packedNotShipped,
      // OV-157b: packed but uncollected is the alarm state — orders finished
      // on the floor and still sitting there are why shipping stalled.
      tone: 'critical',
      footprint: { tw: 1.8, td: 0.9 },
      deepLink: '/order-flow',
    },
    {
      id: 'shipped',
      // OUTBOUND-TRUTH-01: scope is in the label because this counts only
      // orders shipped through the WMS path (order_warehouse_status.shipped_at).
      // Analytics' "Shipped today" counts order_fulfillment_status instead and
      // legitimately includes orders fulfilled outside laSyncro — on shop 2
      // that is 3 vs 0. Both facts are true; one label for both was not.
      label: 'Shipped from floor',
      side: 'outbound',
      rank: 1,
      count: shippedToday,
      footprint: { tw: 1.2, td: 0.6 },
      deepLink: '/order-flow',
    },
  ] : [];

  // OUTBOUND-CONSOLIDATE-01: outbound blocks are dropped when the ship zone
  // owns them, so OV-40's zero-count omission logic stays untouched.
  const stations: SyntheticStation[] = allStations.filter(s =>
    outboundZoneCode == null || (s.id !== 'staged' && s.id !== 'shipped')
  );

  // OV-HOVER-02: Location Pulse payloads. Every row is sourced from data
  // already derived above — no new fetch. Rows are omitted at zero rather than
  // padded, so a calm bin stays calm and an active one visibly fills up.
  // Deliberately absent: occupancy % (capacity is a rack_levels×10 proxy, not
  // merchant truth) and blocked revenue (no per-stage source exists yet).
  const relativeTime = (ms: number): string => {
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
  };

  const locationPulseByCode: Record<string, LocationPulse> = {};
  if (hasMapTier) {
    for (const z of zones) {
      if (z.type !== 'bin' || !z.location_code) continue;
      const code = z.location_code;
      const act = liveActivity?.[code];
      const rows: LocationPulse['rows'] = [];

      // Always present: the one fact every bin can answer truthfully.
      rows.push({
        label: 'On hand',
        value: `${occupancyQuery.data?.occupancy?.[code]?.on_hand_quantity ?? 0} units`,
      });

      if (act && act.operatorCount > 0) {
        const phases = [
          (act.pickingCount ?? 0) > 0 ? `${act.pickingCount} picking` : null,
          (act.packingCount ?? 0) > 0 ? `${act.packingCount} packing` : null,
        ].filter(Boolean).join(', ');
        rows.push({
          label: 'Operators',
          value: phases ? `${act.operatorCount} · ${phases}` : String(act.operatorCount),
          tone: (act.staleCount ?? 0) > 0 ? 'warning' : 'default',
        });
      }

      const problems = problemByLocation[code] ?? 0;
      if (problems > 0) {
        rows.push({ label: 'Open problems', value: String(problems), tone: 'critical' });
      }

      const stow = stowPending[code] ?? 0;
      if (stow > 0) rows.push({ label: 'Awaiting stow', value: `${stow} units` });

      const dock = receiveAtDock[code] ?? 0;
      if (dock > 0) rows.push({ label: 'At dock', value: `${dock} units` });

      // OUTBOUND-CONSOLIDATE-01: order-scoped outbound counts, shown only on
      // the zone that owns them. Orders, not units — never conflate the two.
      if (code === outboundZoneCode) {
        const orderNoun = (n: number) => `${n} ${n === 1 ? 'order' : 'orders'}`;
        if (packedNotShipped > 0) {
          rows.push({
            label: 'Awaiting pickup',
            value: orderNoun(packedNotShipped),
            tone: 'critical',
          });
        }
        if (shippedToday > 0) {
          rows.push({ label: 'Shipped from floor', value: orderNoun(shippedToday) });
        }
      }

      // Only when an operator row actually produced a clock. Absence of
      // activity is silence, never "never".
      if (act?.lastActivityAt) {
        rows.push({ label: 'Last activity', value: relativeTime(act.lastActivityAt), tone: 'muted' });
      }

      locationPulseByCode[code] = {
        title: z.zone_type ? `${code} · ${z.zone_type.toUpperCase()}` : code,
        rows,
      };
    }
  }

  // State strings are merchant-readable plain English (OV-40 rule) and live
  // here, not in the shared renderer.
  const STATION_STATE: Record<string, string> = {
    blocked: 'Needs attention',
    pool: 'Ready for release',
    staged: 'Packed · awaiting carrier',
    shipped: 'Shipped today',
  };
  const stationPulseById: Record<string, LocationPulse> = {};
  for (const s of stations) {
    stationPulseById[s.id] = {
      title: s.label.toUpperCase(),
      rows: [
        { label: 'Orders', value: String(s.count), tone: s.tone === 'critical' ? 'critical' : 'default' },
        { label: 'State', value: STATION_STATE[s.id] ?? '—', tone: 'muted' },
      ],
    };
  }

    // Three-branch gate — see playbook §3.
  // OV-ENTRY-001: Growth/Scale users must NEVER see Core triage layout,
  // even while floor data is loading. A stable loading placeholder occupies
  // the map slot until zones are known.
  let mapContent: React.ReactNode | undefined;
  if (!hasMapTier) {
    mapContent = undefined; // Core/Starter — triage layout (with upgrade teaser)
  } else if (floorPlanning.isLoading) {
    // Growth/Scale — shimmer skeleton holds the map slot.
    // OV-01: Never falls to triage. Resolves to error after 9s timeout (useFloorPlanning).
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', borderRadius: '14px', overflow: 'hidden',
        border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
        p: '22px 24px', display: 'flex', flexDirection: 'column', gap: '12px',
        '@keyframes lsShimmer': {
          '0%': { opacity: 0.45 }, '50%': { opacity: 0.9 }, '100%': { opacity: 0.45 },
        },
      }}>
        <Box sx={{ width: 140, height: 14, borderRadius: '4px', bgcolor: 'rgba(255,255,255,0.07)', animation: 'lsShimmer 1.6s ease-in-out infinite' }} />
        <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gridTemplateRows: 'repeat(3,1fr)', gap: '12px', mt: '8px' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Box key={i} sx={{ borderRadius: '10px', bgcolor: 'rgba(255,255,255,0.045)', animation: 'lsShimmer 1.6s ease-in-out infinite', animationDelay: `${i * 0.12}s` }} />
          ))}
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
          Checking your floor…
        </Typography>
      </Box>
    );
  } else if (floorPlanning.isError) {
    // OV-01: Floor service failed or timed out — explicit recovery state with retry.
    // Without this branch isError silently falls to !hasPlacedFloor, showing
    // "Build your floor" to a user who already has a configured floor.
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', borderRadius: '14px', overflow: 'hidden',
        border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '16px', p: '40px', textAlign: 'center',
      }}>
        <Box sx={{
          width: 44, height: 44, borderRadius: '50%',
          border: '1px solid rgba(229,72,77,0.35)', bgcolor: 'rgba(229,72,77,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F2555A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" />
          </svg>
        </Box>
        <Typography sx={{ fontSize: 21, fontFamily: 'Instrument Serif', color: 'var(--ink)' }}>
          We couldn't load your floor.
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 340 }}>
          The floor service didn't respond. Your data is safe — nothing has changed in your warehouse.
        </Typography>
        <Box
          onClick={() => floorPlanning.refetch()}
          sx={{
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: 12.5,
            fontWeight: 500, color: '#10151E', bgcolor: 'var(--accent)',
            borderRadius: '8px', px: '20px', py: '10px', cursor: 'pointer',
            '&:hover': { opacity: 0.85 },
          }}
        >
          Retry
        </Box>
        <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-3)' }}>
          Error FL-503 · last tried just now
        </Typography>
      </Box>
    );
  } else if (!hasPlacedFloor) {
    // Teaching empty state — no zones configured yet (issue #1040)
    // OV-03: expanded to match activation mockup — progress framing, feature
    // chips, friction-reducer copy, 4-step rail. Rail state is intentionally
    // partial (Option A): only "Connect Shopify" and "Map zones" reflect real
    // data. "Print barcodes"/"Invite pickers" have no backing endpoint or role
    // concept yet (see OV-05 follow-up) and render as static unchecked steps.
    // OV-03 fidelity pass: chip dots use var(--accent) uniformly — no green/
    // amber tokens exist for general decorative use (--confirm-ink is scoped
    // to persisted-state only, per playbook §10); mockup's multi-color dots
    // were non-semantic and would have required hardcoding, which is banned.
    const activationSteps = [
      { label: 'Connect Shopify', done: true },
      { label: 'Map warehouse zones', done: hasPlacedFloor, active: !hasPlacedFloor },
      { label: 'Print location barcodes', done: false, active: false },
      { label: 'Invite your pickers', done: false, active: false },
    ];
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
              Next step · 2 of 4
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>
            Build your floor.
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)', maxWidth: 420, lineHeight: 1.65 }}>
            Map your warehouse zones once — receiving, racking, pick faces, packing — and this canvas turns into live inventory movement, picking activity and bottlenecks.
          </Typography>
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {['Live stock by zone', 'Picker paths', 'Bottleneck alerts'].map((chip) => (
              <Box key={chip} sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 12, fontWeight: 300, color: 'var(--ink-2)', border: '0.5px solid var(--rule)', borderRadius: '999px', px: '12px', py: '5px' }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--accent)' }} />
                {chip}
              </Box>
            ))}
          </Box>
          <Box
            // OV-35: deep-link to Setup → Canvas, not the default Map tab.
            // This CTA only renders when hasPlacedFloor is false, and Map
            // renders an empty canvas reading "No bins configured yet" for
            // exactly that tenant — so the default landed merchants on a dead
            // end two clicks from the tool the button promises. Matches the
            // idle-rail CTA below (same file, live-map branch).
            onClick={() => navigate('/floor-planning?tab=setup&view=canvas')}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', px: '20px', py: '11px', fontSize: 13, fontWeight: 500, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', borderRadius: '8px', cursor: 'pointer', mt: '6px', '&:hover': { bgcolor: 'var(--accent-hover)' } }}
          >
            Set up floor planning →
          </Box>
          <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
            Takes about 10 minutes · You can start with one zone
          </Typography>
        </Box>
        <Box sx={{
          width: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))',
          borderTop: '0.5px solid var(--rule)', bgcolor: 'var(--bg)',
        }}>
          {activationSteps.map((step, i) => (
            <Box key={step.label} sx={{
              display: 'flex', alignItems: 'center', gap: '9px', px: '14px', py: '12px',
              borderRight: i < activationSteps.length - 1 ? '0.5px solid var(--rule)' : 'none',
              minWidth: 0,
            }}>
              {step.done ? (
                <Box sx={{ width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', bgcolor: 'var(--confirm-ink)' }}>
                  <Typography sx={{ fontSize: 10, color: 'var(--surface)', fontWeight: 700, lineHeight: 1 }}>✓</Typography>
                </Box>
              ) : (
                <Box sx={{
                  width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%', border: `0.5px solid ${step.active ? 'var(--accent)' : 'var(--rule)'}`,
                }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, color: step.active ? 'var(--accent)' : 'var(--ink-3)' }}>
                    {i + 1}
                  </Typography>
                </Box>
              )}
              <Typography sx={{
                fontSize: 12, fontWeight: step.active ? 500 : 300,
                color: step.done ? 'var(--ink-2)' : step.active ? 'var(--ink)' : 'var(--ink-3)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {step.label}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    );
  } else {
    // Live map — occupancy overlay on by default
    // OV-09: idle-pick/pack rail replaces the mockup's static stage-count
    // footer with real signal — idleAlerts sources GET /api/v1/alerts
    // filtered to wms_operator_idle (same alerts table "Needs a decision"
    // reads from), not fabricated activity counts.
    const hasIdleAlerts = idleAlerts.alerts.length > 0;
    mapContent = (
      <Box sx={{
        minHeight: 520, height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: '14px', overflow: 'hidden', border: '0.5px solid var(--rule)',
      }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <IsometricCanvas
            zones={zones}
            occupancy={occupancyQuery.data?.occupancy}
            stations={stations}
            liveActivity={liveActivity}
            packQueueCount={packQueueCount}
            stowPending={stowPending}
            problemByLocation={problemByLocation}
            problemTaskTotal={problemTaskTotal}
            unlocatedProblemTaskTotal={unlocatedProblemTaskTotal}
            stowPendingTotal={stowPendingTotal}
            receiveAtDock={receiveAtDock}
            receiveAtDockTotal={receiveAtDockTotal}
            showMarkerKey
            awaitingPackCount={awaitingPackCount}
            showLegend={false}
            showControls={false}
            showWarehouseContext
            enableHoverFocus
            locationPulseByCode={locationPulseByCode}
            stationPulseById={stationPulseById}
            disablePan
            autoFit
            fitPhysicalFloorFirst
            apronReserveRatio={0.22}
            fitPadding={0.88}
          />
        </Box>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: '10px', px: '16px', py: '11px',
          borderTop: '0.5px solid var(--rule)', bgcolor: 'var(--bg)', flexShrink: 0,
        }}>
          {hasIdleAlerts ? (
            <>
              <Box sx={{
                width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--warning-ink)', flexShrink: 0,
                '@keyframes ov09Pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
                animation: 'ov09Pulse 2s ease-in-out infinite',
              }} />
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                {idleAlerts.alerts.length} idle {idleAlerts.alerts.length === 1 ? 'operator' : 'operators'}
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                — {idleAlerts.alerts[0].message}
              </Typography>
            </>
            ) : activeBatches.length > 0 ? (
            <>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--confirm-ink)', flexShrink: 0 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                {pickingBatches.length > 0 && `${pickingBatches.length} picking`}
                {pickingBatches.length > 0 && packingBatches.length > 0 && ' · '}
                {packingBatches.length > 0 && `${packingBatches.length} packing`}
              </Typography>
              {batchProgressPct !== null && (
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                  — {batchProgressPct}% units picked
                </Typography>
              )}
            </>
            ) : (
            // Calm state per overview-live-map-playbook.md §4 — floor is idle,
            // not broken. Distinct from the idle-operator alert above.
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
              Floor is clear · No active batches
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Box
            onClick={() => navigate('/floor-planning?tab=setup&view=canvas')}
            sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', flexShrink: 0, '&:hover': { opacity: 0.75 } }}
          >
            Open floor →
          </Box>
        </Box>
      </Box>
    );
  }

  if (overviewModules.isPending) return null;
  if (overviewModules.isError) return null;

  const overviewProps = mapOverviewFt2Props(overviewModules.data, trust.data ?? null);

  return (
    <>
      <ProfileCompletionBanner />
        <OverviewModuleFT2
          {...overviewProps}
          operationalWarningState={operationalWarningState}
          userName={user?.first_name ?? null}
          morningBrief={isOwnerOrAdmin ? (morningBrief.isPending || morningBrief.isError ? undefined : (morningBrief.data ?? null)) : undefined}
          currency={displayCurrency}
          mapContent={mapContent}
          upgradeTeaser={
            isOwnerOrAdmin && !hasMapTier ? (
              <LiveMapUpgradeTeaser onUpgrade={() => navigate('/settings/billing')} />
            ) : undefined
          }
          onNavigate={(deepLink) => navigate(deepLink)}
          onRefreshBrief={() => setForceRefresh(f => !f)}
          onExportBrief={async () => setExportDrawerOpen(true)}
        />
      <ExportDrawer
        open={exportDrawerOpen}
        onClose={() => setExportDrawerOpen(false)}
        userTier={tier}
        reportIds={['brief', 'orders-all', 'returns', 'finances']}
      />
    </>
  );
}