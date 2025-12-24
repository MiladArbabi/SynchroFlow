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
import { useDashboardState } from 'contexts/DashboardStateContext';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';

import { DataSyncingModal } from 'components/DataSyncingModal';

interface DashboardPageProps {
  handleSidenavToggle: () => void;
}

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

  // --- RENDER ---
  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      <DataSyncingModal
        onClose={handleFT0ModalClose}
        open={false}      
      />
    </OnboardingUIActionsContext.Provider>
  );
};
