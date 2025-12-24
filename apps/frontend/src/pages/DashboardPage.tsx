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

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingUIActionsContext } from 'contexts/OnboardingUIActionsContext';

interface DashboardPageProps {
  handleSidenavToggle: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = () => {
  const navigate = useNavigate();
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

  // --- RENDER ---
  return (
    <OnboardingUIActionsContext.Provider value={uiActions}>
      <div>
        {/* dashboard widgets / layout go here */}
      </div>
    </OnboardingUIActionsContext.Provider>
  );
};
