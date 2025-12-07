/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/DashboardPage.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';

import { useQueryClient } from '@tanstack/react-query';
import { DataSyncingModal } from 'components/DataSyncingModal';
import { ConnectStoreModal } from 'components/ConnectStoreModal';
import { ConnectionErrorModal } from 'components/ConnectionErrorModal';
import { Ft0Phase } from 'types/onboarding';

import { useIntegration } from 'contexts/IntegrationContext';
import { useAuth } from 'contexts/AuthContext';
import { DashboardStateManager } from 'components/DashboardStateManager/DashboardStateManager';

import { WidgetLayoutWithRegistry } from 'components/widgets/WidgetLayoutWithRegistry';

//import { SpecterOnboardingBanner } from 'components/specter/SpecterOnboardingBanner';
import { SyncProgressBanner } from 'components/SyncProgressBanner';
import { OrdersPerMonthBanner } from 'components/OrdersPerMonthBanner';
import { useDashboardState } from 'contexts/DashboardStateContext';

import {
  OnboardingUIActionsContext,
} from 'contexts/OnboardingUIActionsContext';
import { useNavigate } from 'react-router-dom';

export const DashboardPage = ({ children, handleSidenavToggle } : {
  children: React.ReactNode;
  handleSidenavToggle: () => void;
}) => {
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const { hasIntegrations, syncStatus, refreshIntegrationStatus } = useIntegration();

  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { userState } = useDashboardState();

  // constants + tracking
  const MIN_MODAL_MS = 3200;
  const POST_SYNC_SKELETON_MS = 2000;

  // Tracks when the modal was opened for enforcing the minimum visible time
  const openedAtRef = useRef<number | null>(null);

  // Tracks whether we've already reacted to the store getting its first integration
  const lastHasIntegrationsRef = useRef<boolean>(false);

  // State for our modals
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // For phase transition logs (not just snapshots)
  const ft0PhaseRef = useRef<Ft0Phase | null>(null);

  // post-sync skeleton flag
  const [showPostSyncSkeleton, setShowPostSyncSkeleton] = useState(false);
  const forceSkeleton = isSyncModalOpen || showPostSyncSkeleton;

  /**
   * FT0 onboarding state machine for the dashboard.
   *
   * This derives a single phase value from:
   * - hasIntegrations
   * - modal visibility (connect + sync)
   * - syncStatus
   * - the short post-sync skeleton window
   *
   * DashboardStateManager consumes this to decide between:
   * - empty state (pre-connect / loading)
   * - sync/loading views
   * - post-sync skeleton
   * - steady-state widgets.
   */

  const ft0Phase: Ft0Phase = (() => {
  // No integrations, no modals ⇒ pure pre-connect
    if (!hasIntegrations && !isConnectModalOpen && !isSyncModalOpen) {
      return 'PRE_CONNECT';
    }

    // Actively connecting via modal / OAuth
    if (isConnectModalOpen) {
      return 'CONNECTING';
    }

    // Initial sync modal is visible ⇒ syncing
    if (isSyncModalOpen) {
      return 'SYNCING';
    }

    // Integration exists and sync isn't completed yet ⇒ background sync
    if (hasIntegrations && syncStatus !== 'COMPLETED') {
      return 'SYNCING';
    }

    // Short post-sync staging window with skeleton
    if (showPostSyncSkeleton) {
      return 'POST_SYNC_SKELETON';
    }

    // Normal steady-state dashboard
    return 'STEADY_STATE';
  })();

  const uiActions = React.useMemo(() => ({
      openModal: (id: string) => {
        if (id === 'connect-store') {
          handleOpenConnectModal();
        }
        // later: other modal IDs (specter-config, cost-model, etc.)
      },
      navigate: (path: string) => {
        navigate(path);
      },
    }),
    [navigate] // + any handlers you reference
  );

  useEffect(() => {
    const connectStatus = searchParams.get('connect');
    const errorMessage = searchParams.get('message');

    console.log('[DashboardPage] useEffect(searchParams) fired', {
      connectStatus,
      errorMessage,
      currentUrl: window.location.href,
    });

    if (connectStatus === 'success') {
      console.log(
        '[DashboardPage] OAuth success detected via query param. Opening DataSyncingModal.'
      );

      // Refresh the integration/sync status so the modal has the latest info
      refreshIntegrationStatus();

      openedAtRef.current = Date.now();
      setIsSyncModalOpen(true);

      // Clear the query params to avoid re-triggering on refresh
      setSearchParams({}, { replace: true });
    } else if (connectStatus === 'error') {
      console.log('[DashboardPage] OAuth error detected via query param.', {
        errorMessage,
      });
      setConnectionError(errorMessage || 'An unknown connection error occurred.');
      setSearchParams({}, { replace: true });
    } else {
      console.log(
        '[DashboardPage] No connect query param. Likely direct dashboard navigation.'
      );
    }
  }, []); // we intentionally run this only once on mount

  // --- Auto-open modal when the shop gets its first integration ---
  useEffect(() => {
    const prev = lastHasIntegrationsRef.current;
    const curr = hasIntegrations;

    // Read "has seen sync modal" flag from sessionStorage
    let hasSeenSyncModal = false;
    if (typeof window !== 'undefined') {
      hasSeenSyncModal =
        window.sessionStorage.getItem('hasSeenSyncModal') === 'true';
    }

    console.log('[DashboardPage] hasIntegrations change', {
      previous: prev,
      current: curr,
      isSyncModalOpen,
      hasSeenSyncModal,
    });

    // Only react when going from "no integrations" -> "has integrations"
    // AND we haven't already shown the modal in this browser session.
    if (!prev && curr && !isSyncModalOpen && !hasSeenSyncModal) {
      console.log(
        '[DashboardPage] Detected first integration connection. Opening DataSyncingModal.'
      );
      openedAtRef.current = Date.now();
      setIsSyncModalOpen(true);

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('hasSeenSyncModal', 'true');
      }
    }

    lastHasIntegrationsRef.current = curr;
  }, [hasIntegrations, isSyncModalOpen]);

    // --- Enforce "modal visible for at least MIN_MODAL_MS" rule ---
    useEffect(() => {
      if (!isSyncModalOpen) return;

      const openedAt = openedAtRef.current ?? Date.now();
      const elapsed = Date.now() - openedAt;
      const remaining = Math.max(0, MIN_MODAL_MS - elapsed);

      console.log('[DashboardPage] DataSyncingModal open, scheduling close.', {
        elapsed,
        remaining,
      });

      const timer = window.setTimeout(() => {
        handleSyncModalClose();
      }, remaining);

      return () => window.clearTimeout(timer);
    }, [isSyncModalOpen]);

    // For phase transition logs (not just snapshots)
    useEffect(() => {
      if (ft0PhaseRef.current !== ft0Phase) {
        console.log('[DashboardPage] FT0 phase changed', {
          previous: ft0PhaseRef.current,
          current: ft0Phase,
          hasIntegrations,
          syncStatus,
          showPostSyncSkeleton,
          userId: userState?.user.id,
        });
        ft0PhaseRef.current = ft0Phase;
      }
    }, [ft0Phase, hasIntegrations, syncStatus, showPostSyncSkeleton, userState]);

 const handleOpenConnectModal = async () => {
    // 5. Implement the Pre-flight Check
    try {
      // Use the accessToken from AuthContext for the protected endpoint
      await axios.get('/api/v1/integrations/pre-flight', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      // All systems go! Open the modal.
      setIsConnectModalOpen(true);

    } catch (err: any) {
      // Pre-flight check failed! Show the error modal.
      const issues = err.response?.data?.issues || ['An unknown server error occurred.'];
      setConnectionError(`System check failed: ${issues.join(' ')}`);
    }
  };

 const handleRetry = () => {
   setConnectionError(null); // Close the error modal
   handleOpenConnectModal(); // Open the connect modal
 };

  // 3. Create the "Aha! Refresh" handler
  const handleSyncModalClose = () => {
    console.log('[DashboardPage] Closing DataSyncingModal.');

    setIsSyncModalOpen(false);

    // Short "staging" skeleton after modal closes
    setShowPostSyncSkeleton(true);
    window.setTimeout(() => {
      console.log('[DashboardPage] Post-sync skeleton window elapsed.');
      setShowPostSyncSkeleton(false);
    }, POST_SYNC_SKELETON_MS);

    // Ring the "doorbell" for all our data (Aha! moment)
    setTimeout(() => {
      console.log('[DashboardPage] Invalidating dashboardPulse & opsIntelSummary.');
      queryClient.invalidateQueries({ queryKey: ['dashboardPulse'] });
      queryClient.invalidateQueries({ queryKey: ['opsIntelSummary'] });
    }, 100);

    setTimeout(() => {
      console.log('[DashboardPage] Invalidating dashboardInventory.');
      queryClient.invalidateQueries({ queryKey: ['dashboardInventory'] });
    }, 300);

    setTimeout(() => {
      console.log('[DashboardPage] Invalidating dashboardShipments.');
      queryClient.invalidateQueries({ queryKey: ['dashboardShipments'] });
    }, 500);
  };

  return (
    <>
      <OnboardingUIActionsContext.Provider value={uiActions}>
        {/* --- AHA-FLOW: Render Modals --- */}
        {/* 6. Conditionally render the banner */}
        <ConnectStoreModal
          isOpen={isConnectModalOpen}
          onClose={() => setIsConnectModalOpen(false)}
        />

        <ConnectionErrorModal
          open={!!connectionError}
          error={connectionError}
          onClose={() => setConnectionError(null)}
          onRetry={handleRetry}
        />
        <DataSyncingModal
          open={isSyncModalOpen}
          onClose={handleSyncModalClose}
          data-testid="data-syncing-modal"
        />

        <DashboardStateManager
          onConnectStore={handleOpenConnectModal}
          forceLoadingSkeleton={forceSkeleton}
          ft0Phase={ft0Phase}
        >
          {/* Sync progress for initial + recurring syncs */}
          <SyncProgressBanner />

          {/* Orders-per-month segmentation (FT0 micro-step #1) */}
          <OrdersPerMonthBanner />

          {/* Specter onboarding nudges */}
          {/* <SpecterOnboardingBanner /> */}

          {/* Widget system integration */}
          <WidgetLayoutWithRegistry />
        </DashboardStateManager>
      </OnboardingUIActionsContext.Provider>
    </>
  );
};