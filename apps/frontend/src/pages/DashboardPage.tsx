// apps/frontend/src/pages/DashboardPage.tsx
import React, { useMemo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';

import { useDashboardState } from 'contexts/DashboardStateContext';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';

import { DashboardStateManager } from 'components/DashboardStateManager/DashboardStateManager';
import { WidgetLayoutWithRegistry } from 'components/widgets/WidgetLayoutWithRegistry';
import { SyncProgressBanner } from 'components/SyncProgressBanner';
import { OrdersPerMonthBanner } from 'components/OrdersPerMonthBanner';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import { DataSyncingModal } from 'components/DataSyncingModal';

interface DashboardPageProps {
  handleSidenavToggle: () => void;
}

type DashboardPhase =
  | 'LOADING'
  | 'FT_MINUS_ONE'
  | 'FT0_SYNCING'
  | 'FT0_ANALYZING'
  | 'FT1_READY';

export const DashboardPage: React.FC<DashboardPageProps> = () => {
  const navigate = useNavigate();

  /**
   * FT0-A UX latch
   * ----------------
   * Guarantees DataSyncingModal is shown once per session
   * even if backend FT0 completes instantly.
   *
   * This is a UX concern — NOT backend truth.
   */
  const [hasShownFT0Syncing, setHasShownFT0Syncing] = useState<boolean>(() => {
    return sessionStorage.getItem('ft0-syncing-shown') === 'true';
  });

  // --- USER STATE (facts, not orchestration) ---
  const { userState, isLoading: isUserStateLoading } = useDashboardState();

  // --- ACTIVATION VERDICT (single orchestration truth) ---
  const { data: activationVerdict, isLoading: isActivationLoading } = useQuery({
    queryKey: ['activation-verdict'],
    queryFn: async () => {
      const res = await axiosInstance.get('/api/v1/activation/verdict');
      return res.data.activationSurface;
    },
    staleTime: 30_000,
  });

  // --- DASHBOARD PHASE (PURE DERIVATION) ---
  const dashboardPhase: DashboardPhase = useMemo(() => {
    if (isActivationLoading || isUserStateLoading) return 'LOADING';

    const ft0 = activationVerdict?.ft0;

    if (!ft0) return 'FT_MINUS_ONE';

    // 🔒 FT0-A must render once, regardless of backend timing
    if (!hasShownFT0Syncing) {
      return 'FT0_SYNCING';
    }

    if (ft0.isBlocking) return 'FT0_SYNCING';

    if (!userState?.user.first_insight_delivered) {
      return 'FT0_ANALYZING';
    }

    return 'FT1_READY';
  }, [
    activationVerdict?.ft0, 
    hasShownFT0Syncing, 
    isActivationLoading, 
    isUserStateLoading, 
    userState?.user.first_insight_delivered
  ]);

  const handleFT0ModalClose = () => {
    sessionStorage.setItem('ft0-syncing-shown', 'true');
    setHasShownFT0Syncing(true);
  };

  // --- UI ACTIONS (PASSIVE) ---
  const uiActions = useMemo(
    () => ({
      openModal: (id: string) => {
        console.warn(
          '[DashboardPage] openModal called but dashboard is passive:',
          id
        );
      },
      navigate: (path: string) => navigate(path),
    }),
    [navigate]
  );

  // --- CONNECT STORE INTENT ---
  const handleConnectStoreIntent = () => {
    window.dispatchEvent(new CustomEvent('ui:connect-store'));
  };

  // --- LOADING (SKELETONS ONLY) ---
  if (dashboardPhase === 'LOADING') {
    return (
      <OnboardingUIActionsContext.Provider value={uiActions}>
        <DashboardStateManager
          children
          onConnectStore={handleConnectStoreIntent}
          forceLoadingSkeleton
        >
          {/* Skeletons rendered by DashboardStateManager */}
        </DashboardStateManager>
      </OnboardingUIActionsContext.Provider>
    );
  }

  // --- RENDER ---
  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      {/* FT0 emotional buffer — authoritative */}
      <DataSyncingModal
        open={dashboardPhase === 'FT0_SYNCING'}
        onClose={handleFT0ModalClose}
      />

      <DashboardStateManager onConnectStore={handleConnectStoreIntent}>
        {dashboardPhase === 'FT_MINUS_ONE' && null}

        {dashboardPhase === 'FT0_ANALYZING' && (
          <EmptyDashboardState
            onConnectStore={handleConnectStoreIntent}
            userState={{
              shopify_connected: true,
              first_insight_delivered: false,
            }}
          />
        )}

        {dashboardPhase === 'FT1_READY' && (
          <>
            <SyncProgressBanner />
            <OrdersPerMonthBanner />
            <WidgetLayoutWithRegistry />
          </>
        )}
      </DashboardStateManager>
    </OnboardingUIActionsContext.Provider>
  );
};
