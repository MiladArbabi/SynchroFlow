/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/DashboardStateManager/DashboardStateManager.tsx
import * as React from 'react';
import { Box, Skeleton } from '@mui/material';
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

  // Combined "real" loading (excluding the post-sync skeleton flag)
  const isLoading = isStateLoading || isSyncLoading;

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

  // 1) Post-sync skeleton window: this overrides normal loading/layout
  if (forceLoadingSkeleton) {
    console.log('[DashboardStateManager] Rendering post-sync skeleton.');
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} />
      </Box>
    );
  }

  // 2) Normal loading / sync in progress
  if (isLoading || isSyncing) {
    console.log('[DashboardStateManager] Rendering EmptyDashboardState (loading/syncing).');
    return (
      <EmptyDashboardState
        onConnectStore={onConnectStore}
        userState={emptyStateUserData}
      />
    );
  }

  // 3) Not loading, but effectively "empty"
  if (currentView === 'empty') {
    if (!hasIntegrations) {
      console.log('[DashboardStateManager] Rendering EmptyDashboardState (no integrations).');
      return (
        <EmptyDashboardState
          onConnectStore={onConnectStore}
          userState={emptyStateUserData}
        />
      );
    }

    // We *do* have integrations, so "empty" is just a momentary transition.
    console.log(
      '[DashboardStateManager] Rendering skeleton for integrated shop with empty view.'
    );
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} />
      </Box>
    );
  }

  // 4) Fully ready: render the actual dashboard widgets
  console.log('[DashboardStateManager] Rendering dashboard children (widgets).');
  return (
    <Box sx={{ p: 2 }}>
      {children}
    </Box>
  );
};