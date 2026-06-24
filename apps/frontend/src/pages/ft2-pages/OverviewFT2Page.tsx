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
import { ProfileCompletionBanner } from '../overview/ProfileCompletionBanner';
import { ExportDrawer } from 'components/ExportDrawer';

export default function OverviewPageFT2() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [forceRefresh, setForceRefresh] = useState(false);
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);
  const overviewModules = useOverviewModulesFt2Snapshot(undefined, !authLoading);
  const trust = useTrustFt2Snapshot(!authLoading);
  const operationalControl = null;
  const morningBrief = useMorningBriefSnapshot(forceRefresh, !authLoading);

  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';
  const { displayCurrency, tier } = useEntitlements();

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
        onNavigate={(deepLink) => navigate(deepLink)}
        onRefreshBrief={() => setForceRefresh(f => !f)}
        onExportBrief={async () => setExportDrawerOpen(true)}
        onResolveAll={() => navigate('/orders?filter=blocked')}
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
