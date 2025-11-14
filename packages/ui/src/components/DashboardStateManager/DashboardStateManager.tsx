// packages/ui/src/components/DashboardStateManager/DashboardStateManager.tsx
import * as React from 'react';
import { Box } from '@mui/material';
import { useDashboardState } from '../../contexts/DashboardStateContext';
import { EmptyDashboardState } from '../EmptyStates/EmptyDashboardState';

interface DashboardStateManagerProps {
  onConnectStore: () => void;
  children: React.ReactNode;
}

export const DashboardStateManager: React.FC<DashboardStateManagerProps> = ({ 
  onConnectStore, 
  children 
}) => {
  const { currentView, userState, isLoading } = useDashboardState();

  // Extract the user data for EmptyDashboardState
  const emptyStateUserData = userState ? {
    shopify_connected: userState.user.shopify_connected,
    first_insight_delivered: userState.user.first_insight_delivered
  } : undefined;

  // Show loading state
  if (isLoading) {
    return (
      <EmptyDashboardState 
        onConnectStore={onConnectStore} 
        userState={emptyStateUserData}
      />
    );
  }

  // Show empty states based on user progression
  if (currentView === 'empty') {
    return (
      <EmptyDashboardState 
        onConnectStore={onConnectStore} 
        userState={emptyStateUserData}
      />
    );
  }

  // For now, return children for survival/growth/architect modes
  // We'll enhance this with mode-specific layouts later
  return (
    <Box sx={{ p: 2 }}>
      {children}
    </Box>
  );
};