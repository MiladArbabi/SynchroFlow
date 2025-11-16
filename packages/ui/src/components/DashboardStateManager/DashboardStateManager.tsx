// packages/ui/src/components/DashboardStateManager/DashboardStateManager.tsx
import * as React from 'react';
import { Box } from '@mui/material';
import { useDashboardState } from '../../contexts/DashboardStateContext';
import { useIntegration } from '../../contexts/IntegrationContext'; 
import { EmptyDashboardState } from '../EmptyStates/EmptyDashboardState';

interface DashboardStateManagerProps {
  onConnectStore: () => void;
  children: React.ReactNode;
}

export const DashboardStateManager: React.FC<DashboardStateManagerProps> = ({ 
  onConnectStore, 
  children 
}) => {
  const { currentView, userState, isLoading: isStateLoading } = useDashboardState();
  const { isLoading: isSyncLoading, syncStatus } = useIntegration();

  // Extract the user data for EmptyDashboardState
 const emptyStateUserData = userState ? {
  shopify_connected: userState.user.shopify_connected,
  first_insight_delivered: userState.user.first_insight_delivered
 } : undefined;

  // COMBINE THE LOADING CHECKS
  const isLoading = isStateLoading || isSyncLoading;

  // CHECK IF A SYNC IS IN PROGRESS
  const isSyncing = ['PENDING', 'SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETING'].includes(syncStatus);

 // Show loading state or empty state if we are loading OR syncing
 if (isLoading || isSyncing) { // <-- 5. UPDATE THIS CONDITION
  return (
   <EmptyDashboardState
    onConnectStore={onConnectStore}
    userState={emptyStateUserData}
    // isSyncing prop removed to fix TS error.
    // The EmptyDashboardState will now correctly show its own
    // loading skeleton or 'connected' message based on userState.
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