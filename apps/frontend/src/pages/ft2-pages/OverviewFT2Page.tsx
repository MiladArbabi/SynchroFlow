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
import type { SyntheticStation, LiveBinActivity, WarehouseZone } from '@lasyncro/shared/ui';
import { sendEvent } from 'analytics/adapter';

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
          fitPadding={0.68}
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
  const occupancyQuery = useWarehouseGridOccupancy(hasMapTier && zones.length > 0);
  // useOrderPool provides inbound apron data (eligible_order_count, summary.blocked_count).
  // Data consumed by apron stations prop once SyntheticStation lands in v1-B task 4.
  const orderPool = useOrderPool();
  // Live activity — picker positions from pick_scan_log, 15s poll.
  // Disabled for non-scale tenants — avoids unnecessary polling.
  const liveActivityQuery = useWmsLiveActivity(hasMapTier);
  const liveActivity = liveActivityQuery.data?.pickerPositions.reduce<Record<string, LiveBinActivity>>(
    (acc, p) => {
      const existing = acc[p.location_code];
      acc[p.location_code] = {
        operatorCount: (existing?.operatorCount ?? 0) + 1,
        hasActivePick: true,
      };
      return acc;
    },
    {}
  );

  // Inbound apron — order pool count + constrained (blocked) sub-stack.
  // Outbound apron wired in v2 once useLiveCapacity is added to this page.
  const stations: SyntheticStation[] = hasMapTier ? [
    {
      id: 'inbound',
      label: 'Order pool',
      side: 'inbound',
      count: orderPool.data?.eligible_order_count ?? 0,
      urgentCount: orderPool.data?.summary?.blocked_count ?? 0,
      deepLink: '/order-flow',
    },
  ] : [];

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
        height: 520, borderRadius: '14px', overflow: 'hidden',
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
    // Without this branch isError silently falls to zones.length === 0, showing
    // "Build your floor" to a user who already has a configured floor.
    mapContent = (
      <Box sx={{
        height: 520, borderRadius: '14px', overflow: 'hidden',
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
  } else if (zones.length === 0) {
    // Teaching empty state — no zones configured yet (issue #1040)
    mapContent = (
      <Box sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: 420, bgcolor: 'var(--surface)',
        border: '0.5px solid var(--rule)', borderRadius: '14px', gap: '12px', p: '2rem',
      }}>
        <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
          Build your floor
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
          Add your warehouse zones to see live operations here.
        </Typography>
        <Box
          onClick={() => navigate('/floor-planning')}
          sx={{ display: 'inline-flex', alignItems: 'center', px: '14px', py: '7px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 }}}
        >
          Set up floor planning →
        </Box>
      </Box>
    );
  } else {
    // Live map — occupancy overlay on by default
    mapContent = (
      <Box sx={{ height: 520, borderRadius: '14px', overflow: 'hidden', border: '0.5px solid var(--rule)' }}>
        <IsometricCanvas
          zones={zones}
          occupancy={occupancyQuery.data?.occupancy}
          stations={stations}
          liveActivity={liveActivity}
          showLegend={false}
          showControls={false}
          disablePan
          autoFit
          fitPadding={0.68}
        />
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