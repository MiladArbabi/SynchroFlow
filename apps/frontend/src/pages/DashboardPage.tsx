// apps/frontend/src/pages/DashboardPage.tsx
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
        <div>This is the dashboard in frontend/src/pages</div>
      </div>
    </OnboardingUIActionsContext.Provider>
  );
};
