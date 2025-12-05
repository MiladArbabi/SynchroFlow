/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/DashboardStateManager/DashboardStateManager.tsx
import * as React from 'react';
import { Box } from '@mui/material';
import { useDashboardState } from '../../contexts/DashboardStateContext';
import { useIntegration } from '../../contexts/IntegrationContext'; 
import { EmptyDashboardState } from '../EmptyStates/EmptyDashboardState';

interface DashboardStateManagerProps {
  onConnectStore: () => void;
  children: React.ReactNode;
  forceLoadingSkeleton?: boolean;
}

export const DashboardStateManager: React.FC<DashboardStateManagerProps> = ({
  onConnectStore,
  children,
  forceLoadingSkeleton = false,
}) => {
  const { currentView, userState, isLoading: isStateLoading } = useDashboardState();
  const { isLoading: isSyncLoading, syncStatus, hasIntegrations } = useIntegration();

  const emptyStateUserData = userState
    ? {
        shopify_connected: userState.user.shopify_connected,
        first_insight_delivered: userState.user.first_insight_delivered,
      }
    : undefined;

  // Combined loading
  // Combined loading
  const isLoading = isStateLoading || isSyncLoading || forceLoadingSkeleton;

  // Sync is actively running *only* when we actually have an integration.
  const inProgressStatuses: string[] = [
    'PENDING',
    'SYNCING_PRODUCTS',
    'SYNCING_ORDERS',
    'SYNCING_LINE_ITEMS',
    'SYNCING_INVENTORY',
    'SYNCING_SHOP',
    'COMPLETING',
  ];

  const isSyncing =
    hasIntegrations && inProgressStatuses.includes(syncStatus as string);

  console.log('[DashboardStateManager] render decision', {
    currentView,
    isStateLoading,
    isSyncLoading,
    forceLoadingSkeleton,
    isSyncing,
  });

  if (isLoading || isSyncing) {
    console.log('[DashboardStateManager] Rendering EmptyDashboardState (loading/syncing).');
    return (
      <EmptyDashboardState
        onConnectStore={onConnectStore}
        userState={emptyStateUserData}
      />
    );
  }

  if (currentView === 'empty') {
    console.log('[DashboardStateManager] Rendering EmptyDashboardState (empty view).');
    return (
      <EmptyDashboardState
        onConnectStore={onConnectStore}
        userState={emptyStateUserData}
      />
    );
  }

  console.log('[DashboardStateManager] Rendering dashboard children (widgets).');
  return (
    <Box sx={{ p: 2 }}>
      {children}
    </Box>
  );
};