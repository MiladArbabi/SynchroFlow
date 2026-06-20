/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOverviewModulesFt2Snapshot } from '../overview/useOverviewModulesFt2Snapshot';
import { useTrustFt2Snapshot } from '../trust/useTrustFt2Snapshot';
import { useMorningBriefSnapshot } from '../overview/useMorningBriefSnapshot';
import { OverviewModuleFT2 } from '@lasyncro/overview';
import { mapOverviewFt2Props } from 'pages/overview/useOverviewFt2Adapter';
import { useAuth } from 'contexts/AuthContext';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { axiosInstance } from 'api/axiosConfig';
import { ProfileCompletionBanner } from '../overview/ProfileCompletionBanner';

export default function OverviewPageFT2() {
  const navigate = useNavigate();
  // AFTER
  const { user, isLoading: authLoading } = useAuth();
  const [forceRefresh, setForceRefresh] = useState(false);
  const overviewModules = useOverviewModulesFt2Snapshot(undefined, !authLoading);
  const trust = useTrustFt2Snapshot(!authLoading);
  // ISSUE-002 / ISSUE-003: Overview does NOT borrow the Orders operationalControl
  // snapshot (the order-flow rail belongs to Orders). Overview's right rail is now
  // its own cross-domain Business Pulse (revenue today, collected, at-risk, blocked),
  // sourced via mapOverviewFt2Props → overviewProps.pulse from the modules-ft2 snapshot.
  const operationalControl = null;
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
      <ProfileCompletionBanner />
      <OverviewModuleFT2
        {...overviewProps}
        
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