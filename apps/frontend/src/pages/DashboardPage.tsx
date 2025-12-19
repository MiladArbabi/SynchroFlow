// apps/frontend/src/pages/DashboardPage.tsx
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useIntegration } from 'contexts/IntegrationContext';
import { useDashboardState } from 'contexts/DashboardStateContext';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';

import { DashboardStateManager } from 'components/DashboardStateManager/DashboardStateManager';
import { WidgetLayoutWithRegistry } from 'components/widgets/WidgetLayoutWithRegistry';
import { SyncProgressBanner } from 'components/SyncProgressBanner';
import { OrdersPerMonthBanner } from 'components/OrdersPerMonthBanner';

import { Ft0Phase } from 'types/onboarding';

interface DashboardPageProps {
  handleSidenavToggle: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = () => {
  const navigate = useNavigate();

  const {
    hasIntegrationRecord,
    syncStatus,
    isLoading: isIntegrationLoading,
  } = useIntegration();

  const { isLoading: isDashboardStateLoading } = useDashboardState();

  // -------------------------
  // FT0 PHASE — PURE DERIVATION
  // -------------------------
  const ft0Phase: Ft0Phase = useMemo(() => {
    if (!hasIntegrationRecord) return 'PRE_CONNECT';
    if (syncStatus !== 'COMPLETED') return 'SYNCING';
    return 'STEADY_STATE';
  }, [hasIntegrationRecord, syncStatus]);

  // -------------------------
  // UI ACTIONS (PASSIVE)
  // -------------------------
  const uiActions = useMemo(
    () => ({
      openModal: (id: string) => {
        // Dashboard never owns modals.
        console.warn(
          '[DashboardPage] openModal called but dashboard is passive:',
          id
        );
      },
      navigate: (path: string) => navigate(path),
    }),
    [navigate]
  );

  // -------------------------
  // CONNECT STORE INTENT
  // -------------------------
  const handleConnectStoreIntent = () => {
    // Bubble intent upward — App.tsx is the ONLY listener
    window.dispatchEvent(new CustomEvent('ui:connect-store'));
  };

  const forceLoadingSkeleton =
    isIntegrationLoading || isDashboardStateLoading;

  // -------------------------
  // RENDER
  // -------------------------
  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      <DashboardStateManager
        onConnectStore={handleConnectStoreIntent}
        forceLoadingSkeleton={forceLoadingSkeleton}
        ft0Phase={ft0Phase}
      >
        <SyncProgressBanner />
        <OrdersPerMonthBanner />
        <WidgetLayoutWithRegistry />
      </DashboardStateManager>
    </OnboardingUIActionsContext.Provider>
  );
};
