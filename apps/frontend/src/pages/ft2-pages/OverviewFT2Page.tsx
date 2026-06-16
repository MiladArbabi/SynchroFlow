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
import { axiosInstance } from 'api/axiosConfig';

export default function OverviewPageFT2() {
  const navigate = useNavigate();
  // AFTER
  const { user, isLoading: authLoading } = useAuth();
  const [forceRefresh, setForceRefresh] = useState(false);
  const overviewModules = useOverviewModulesFt2Snapshot(undefined, !authLoading);
  const trust = useTrustFt2Snapshot(!authLoading);
  const ft2Snapshot = useOrdersFt2Snapshot(!authLoading);
  const operationalControl = ft2Snapshot.data?.operationalControl;
  const morningBrief = useMorningBriefSnapshot(forceRefresh, !authLoading);

  /**
   * MORNING BRIEF (OVR-01)
   * ----------------------
   * Owner/admin only — operators have no brief.
   * Null = trust not eligible or brief not computed yet.
   */
  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';
  const { displayCurrency } = useEntitlements();

  if (overviewModules.isPending) return null;
  if (overviewModules.isError) return null;

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
        morningBrief={isOwnerOrAdmin ? (morningBrief.isPending || morningBrief.isError ? undefined : (morningBrief.data ?? null)) : undefined}
        currency={displayCurrency}
        onNavigate={(deepLink) => navigate(deepLink)}
        onRefreshBrief={() => setForceRefresh(f => !f)}
        onExportBrief={async () => {
          try {
            const res = await axiosInstance.post('/api/v1/exports/brief', {}, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `lasyncro-brief-${new Date().toISOString().split('T')[0]}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
          } catch {
            console.error('[OVERVIEW] Export brief failed');
          }
        }}
        onResolveAll={() => navigate('/orders?filter=blocked')}
      />
    </>
  );
}