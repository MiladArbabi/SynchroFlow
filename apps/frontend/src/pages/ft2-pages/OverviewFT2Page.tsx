// File: apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx
// Lines 1–12 (imports)
import { useState } from 'react';
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
import type { SyntheticStation, LiveBinActivity } from '@lasyncro/shared/ui';

export default function OverviewPageFT2() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [forceRefresh, setForceRefresh] = useState(false);
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);

  const overviewModules = useOverviewModulesFt2Snapshot(undefined, !authLoading);
  const trust = useTrustFt2Snapshot(!authLoading);
  const morningBrief = useMorningBriefSnapshot(forceRefresh, !authLoading);

  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';
  const { displayCurrency, tier } = useEntitlements();

  // Map data — all hooks unconditional (Rules of Hooks); data ignored when tier doesn't qualify.
  // Occupancy deferred until zones are loaded (enabled guard) to avoid a redundant request
  // on first paint. Per overview-live-map-playbook.md §3 and §4.
  const hasMapTier = tier === 'scale';
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
  // mapContent=undefined → OverviewModuleFT2 renders triage fallback layout (non-scale teaser TODO).
    const mapContent = (hasMapTier && !floorPlanning.isLoading) ? (
    zones.length > 0 ? (
      // Live map — occupancy overlay on by default
      <Box sx={{ height: '100%', minHeight: 420, borderRadius: '14px', overflow: 'hidden', border: '0.5px solid var(--rule)' }}>
        <IsometricCanvas
          zones={zones}
          occupancy={occupancyQuery.data?.occupancy}
          stations={stations}
          liveActivity={liveActivity}
          autoFit
          fitPadding={24}
          initialZoom={0.85}
        />
      </Box>
    ) : (
      // Teaching empty state — no zones configured yet (issue #1040)
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
          sx={{ display: 'inline-flex', alignItems: 'center', px: '14px', py: '7px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
        >
          Set up floor planning →
        </Box>
      </Box>
    )
  ) : undefined;

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