// apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOverviewModulesFt2Snapshot } from '../overview/useOverviewModulesFt2Snapshot';
import { useTrustFt2Snapshot } from '../trust/useTrustFt2Snapshot';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { useMorningBriefSnapshot } from '../overview/useMorningBriefSnapshot';
import { OverviewModuleFT2 } from '@lasyncro/overview';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { FT2DateRangeBar } from '@lasyncro/ui-ft2';
import { mapOverviewFt2Props } from 'pages/overview/useOverviewFt2Adapter';
import { FirstInsightBanner } from '../overview/FirstInsightBanner';
import { useAuth } from 'contexts/AuthContext';

export default function OverviewPageFT2() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_30_days',
    from: null,
    to: null,
  });
  const [forceRefresh, setForceRefresh] = useState(false);

  const overviewModules = useOverviewModulesFt2Snapshot(range);
  const trust = useTrustFt2Snapshot();

  /**
   * PULSE + FIRST INSIGHT DATA SOURCE (B-05, B-06)
   * -----------------------------------------------
   * Reuses existing FT2 snapshot — no new API calls.
   * operationalControl powers both the Pulse zone and
   * the FirstInsightBanner.
   */
  const ft2Snapshot = useOrdersFt2Snapshot();
  const operationalControl = ft2Snapshot.data?.operationalControl;

  /**
   * MORNING BRIEF (OVR-01)
   * ----------------------
   * Owner/admin only — operators have no brief.
   * Null = trust not eligible or brief not computed yet.
   */
  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';
  const morningBrief = useMorningBriefSnapshot(forceRefresh);

  if (!overviewModules.isSuccess) return null;

  const overviewProps = mapOverviewFt2Props(
    overviewModules.data,
    trust.data ?? null
  );

  return (
    <>
      <FT2DateRangeBar
        value={range}
        onChange={setRange}
      />
      {/**
       * FIRST INSIGHT BANNER (B-06)
       * ---------------------------
       * Shown when constrained orders exist.
       * Dismissed per session via sessionStorage.
       * Navigates operator directly to Fulfillment Queue.
       */}
      <FirstInsightBanner
        constrainedCount={operationalControl?.constrained_orders ?? null}
        atRiskRevenue={operationalControl?.at_risk_revenue ?? null}
        onNavigateToQueue={() => navigate('/fulfillment')}
      />
      <OverviewModuleFT2
        {...overviewProps}

        pulse={operationalControl ? {
          shipToday: operationalControl.queue_ready_to_ship ?? null,
          blockedOrders: operationalControl.constrained_orders ?? null,
          blockedRevenue: operationalControl.at_risk_revenue ?? null,
          aging24h: operationalControl.aging_24h ?? null,
          aging48h: operationalControl.aging_48h ?? null,
          aging72hPlus: operationalControl.aging_72h_plus ?? null,
        } : null}
        
        morningBrief={isOwnerOrAdmin ? (morningBrief.data ?? null) : undefined}
        onNavigate={(deepLink) => navigate(deepLink)}
        onRefreshBrief={() => setForceRefresh(f => !f)}
      />
    </>
  );
}