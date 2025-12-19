/* eslint-disable react-hooks/exhaustive-deps */
// apps/frontend/src/pages/DashboardPage.tsx

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

import { useQueryClient } from '@tanstack/react-query';
import { DataSyncingModal } from 'components/DataSyncingModal';
import { ConnectionErrorModal } from 'components/ConnectionErrorModal';
import { Ft0Phase } from 'types/onboarding';

import { useIntegration } from 'contexts/IntegrationContext';
import { DashboardStateManager } from 'components/DashboardStateManager/DashboardStateManager';

import { WidgetLayoutWithRegistry } from 'components/widgets/WidgetLayoutWithRegistry';
import { SyncProgressBanner } from 'components/SyncProgressBanner';
import { OrdersPerMonthBanner } from 'components/OrdersPerMonthBanner';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';

interface DashboardPageProps {
  handleSidenavToggle: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const queryClient = useQueryClient();
  const { hasIntegrations, syncStatus, refreshIntegrationStatus } =
    useIntegration();

  // -------------------------
  // Constants
  // -------------------------
  const MIN_MODAL_MS = 3200;
  const POST_SYNC_SKELETON_MS = 2000;

  // -------------------------
  // State
  // -------------------------
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [showPostSyncSkeleton, setShowPostSyncSkeleton] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // -------------------------
  // Refs
  // -------------------------
  const openedAtRef = useRef<number | null>(null);
  const lastHasIntegrationsRef = useRef<boolean>(false);
  const ft0PhaseRef = useRef<Ft0Phase | null>(null);

  const forceSkeleton = isSyncModalOpen || showPostSyncSkeleton;

  // -------------------------
  // FT0 Phase Derivation
  // -------------------------
  const ft0Phase: Ft0Phase = (() => {
    if (!hasIntegrations && !isSyncModalOpen) return 'PRE_CONNECT';
    if (isSyncModalOpen) return 'SYNCING';
    if (hasIntegrations && syncStatus !== 'COMPLETED') return 'SYNCING';
    if (showPostSyncSkeleton) return 'POST_SYNC_SKELETON';
    return 'STEADY_STATE';
  })();

  // -------------------------
  // UI Actions (Dashboard-local)
  // -------------------------
  const uiActions = React.useMemo(
    () => ({
      openModal: (id: string) => {
        // Dashboard does NOT own connect-store anymore
        console.warn(
          '[DashboardPage] openModal called but dashboard no longer owns modals:',
          id
        );
      },
      navigate: (path: string) => navigate(path),
    }),
    [navigate]
  );

  // -------------------------
  // OAuth redirect handling
  // -------------------------
  useEffect(() => {
    const connectStatus = searchParams.get('connect');
    const errorMessage = searchParams.get('message');

    if (connectStatus === 'success') {
      refreshIntegrationStatus();
      openedAtRef.current = Date.now();
      setIsSyncModalOpen(true);
      setSearchParams({}, { replace: true });
    }

    if (connectStatus === 'error') {
      setConnectionError(
        errorMessage || 'An unknown connection error occurred.'
      );
      setSearchParams({}, { replace: true });
    }
  }, []);

  // -------------------------
  // Auto-open sync modal on first integration
  // -------------------------
  useEffect(() => {
    const prev = lastHasIntegrationsRef.current;
    const curr = hasIntegrations;

    const hasSeenSyncModal =
      window.sessionStorage.getItem('hasSeenSyncModal') === 'true';

    if (!prev && curr && !isSyncModalOpen && !hasSeenSyncModal) {
      openedAtRef.current = Date.now();
      setIsSyncModalOpen(true);
      window.sessionStorage.setItem('hasSeenSyncModal', 'true');
    }

    lastHasIntegrationsRef.current = curr;
  }, [hasIntegrations, isSyncModalOpen]);

  // -------------------------
  // Enforce minimum sync modal duration
  // -------------------------
  useEffect(() => {
    if (!isSyncModalOpen) return;

    const openedAt = openedAtRef.current ?? Date.now();
    const elapsed = Date.now() - openedAt;
    const remaining = Math.max(0, MIN_MODAL_MS - elapsed);

    const timer = window.setTimeout(handleSyncModalClose, remaining);
    return () => window.clearTimeout(timer);
  }, [isSyncModalOpen]);

  // -------------------------
  // Phase transition debug (optional)
  // -------------------------
  useEffect(() => {
    if (ft0PhaseRef.current !== ft0Phase) {
      ft0PhaseRef.current = ft0Phase;
    }
  }, [ft0Phase]);

  // -------------------------
  // Handlers
  // -------------------------
  const handleRetry = () => {
    setConnectionError(null);
    window.dispatchEvent(new CustomEvent('open-connect-store'));
  };

  const handleConnectStoreIntent = () => {
    window.dispatchEvent(new CustomEvent('open-connect-store'));
  };

  const handleSyncModalClose = () => {
    setIsSyncModalOpen(false);
    setShowPostSyncSkeleton(true);

    window.setTimeout(
      () => setShowPostSyncSkeleton(false),
      POST_SYNC_SKELETON_MS
    );

    setTimeout(
      () => queryClient.invalidateQueries({ queryKey: ['dashboardInventory'] }),
      300
    );
    setTimeout(
      () => queryClient.invalidateQueries({ queryKey: ['dashboardShipments'] }),
      500
    );
  };

  // -------------------------
  // Render
  // -------------------------
  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      <ConnectionErrorModal
        open={!!connectionError}
        error={connectionError}
        onClose={() => setConnectionError(null)}
        onRetry={handleRetry}
      />

      <DataSyncingModal
        open={isSyncModalOpen}
        onClose={handleSyncModalClose}
        ft0Phase={ft0Phase}
      />

      <DashboardStateManager
        forceLoadingSkeleton={forceSkeleton}
        onConnectStore={handleConnectStoreIntent}
        ft0Phase={ft0Phase}
      >
        <SyncProgressBanner />
        <OrdersPerMonthBanner />
        <WidgetLayoutWithRegistry />
      </DashboardStateManager>
    </OnboardingUIActionsContext.Provider>
  );
};
