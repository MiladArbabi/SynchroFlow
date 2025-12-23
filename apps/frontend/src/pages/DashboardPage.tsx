/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/DashboardPage.tsx
/**
 * IMPORTANT ARCHITECTURAL INVARIANT
 * --------------------------------
 * Dashboard FT phase MUST be derived from activationSurface.ft0.phase.
 *
 * - first_insight_delivered is a UX/content signal ONLY
 * - It must NEVER promote FT0 → FT1
 * - Violating this will desync dashboard vs modules
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import { DashboardSkeletons } from 'components/skeletons/DashboardSkeletons';
import { useFT0Promotion } from 'activation/useFT0Promotion';

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
  const [hasShownFT0Analyzing, setHasShownFT0Analyzing] = useState<boolean>(() => {
    return sessionStorage.getItem('ft0-analyzing-shown') === 'true';
  });

  // --- ACTIVATION VERDICT (single orchestration truth) ---
  const { data: activationVerdict, isLoading: isActivationLoading } = useQuery({
    queryKey: ['activation-verdict'],
    queryFn: async () => {
      const res = await axiosInstance.get('/api/v1/activation/verdict');
      return res.data.activationSurface;
    },
    staleTime: 30_000,
  });

  useFT0Promotion(activationVerdict?.ft0?.phase);

  // --- DASHBOARD PHASE (PURE DERIVATION) ---
  const dashboardPhase: DashboardPhase = useMemo(() => {
    if (isActivationLoading || isUserStateLoading) return 'LOADING';

    const ft0Phase = activationVerdict?.ft0?.phase;

    if (!ft0Phase) return 'FT_MINUS_ONE';

    // FT0-A: frontend-latched emotional buffer
    if (!hasShownFT0Syncing) {
      return 'FT0_SYNCING';
    }

    // FT0-B: backend truth
    if (ft0Phase !== 'COMPLETED') {
      return 'FT0_ANALYZING';
    }

    // FT1: backend truth only
    return 'FT1_READY';
  }, [
    isActivationLoading,
    isUserStateLoading,
    activationVerdict?.ft0?.phase,
    hasShownFT0Syncing,
  ]);

  useEffect(() => {
    if (dashboardPhase !== 'FT0_ANALYZING') return;

    const MIN_VISIBLE_MS = 2000;

    const t = setTimeout(() => {
      sessionStorage.setItem('ft0-analyzing-shown', 'true');
      setHasShownFT0Analyzing(true);
    }, MIN_VISIBLE_MS);

    return () => clearTimeout(t);
  }, [dashboardPhase]);


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
          userState?.user.first_insight_delivered ? (
            <>
              <SyncProgressBanner />
              <OrdersPerMonthBanner />
              <WidgetLayoutWithRegistry />
            </>
          ) : (
            <DashboardSkeletons />
          )
        )}
      </DashboardStateManager>
    </OnboardingUIActionsContext.Provider>
  );
};
