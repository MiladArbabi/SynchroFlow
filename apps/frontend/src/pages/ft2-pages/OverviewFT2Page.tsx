// apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOverviewModulesFt2Snapshot } from '../overview/useOverviewModulesFt2Snapshot';
import { useTrustFt2Snapshot } from '../trust/useTrustFt2Snapshot';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { useMorningBriefSnapshot } from '../overview/useMorningBriefSnapshot';
import { OverviewModuleFT2 } from '@lasyncro/overview';
import { mapOverviewFt2Props } from 'pages/overview/useOverviewFt2Adapter';
import { useAuth } from 'contexts/AuthContext';
import { useEntitlements } from 'contexts/EntitlementsContext';

export default function OverviewPageFT2() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [forceRefresh, setForceRefresh] = useState(false);

  const overviewModules = useOverviewModulesFt2Snapshot();
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
  const { displayCurrency } = useEntitlements();
  const morningBrief = useMorningBriefSnapshot(forceRefresh);

  if (!overviewModules.isSuccess) return null;

  const overviewProps = mapOverviewFt2Props(
    overviewModules.data,
    trust.data ?? null
  );

  return (
    <>
      <OverviewModuleFT2
        {...overviewProps}

        pulse={operationalControl ? {
          shipToday: operationalControl.queue_ready_to_ship ?? null,
          blockedOrders: operationalControl.constrained_orders ?? null,
          blockedRevenue: operationalControl.blocked_revenue ?? null,
          aging24h: operationalControl.aging_24h ?? null,
          aging48h: operationalControl.aging_48h ?? null,
          aging72hPlus: operationalControl.aging_72h_plus ?? null,
        } : null}
        
        userName={user?.first_name ?? null}
        morningBrief={isOwnerOrAdmin ? (morningBrief.data ?? null) : undefined}
        currency={displayCurrency}
        onNavigate={(deepLink) => navigate(deepLink)}
        onRefreshBrief={() => setForceRefresh(f => !f)}
        onExportBrief={() => {
          // TODO: implement brief export (PDF/CSV) — stub for now
          console.info('[OVERVIEW] Export brief triggered');
        }}
        onResolveAll={() => navigate('/orders?filter=blocked')}
      />
    </>
  );
}