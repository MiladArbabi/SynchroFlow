/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/DashboardStateManager/DashboardStateManager.tsx

/**
 * IMPORTANT:
 * This component assumes activation has already been resolved.
 * It must never gate content based on integration or activation state.
 * Activation is handled exclusively by ModuleActivationBoundary.
 */

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
  const { isLoading: isSyncLoading, syncStatus } = useIntegration();

  const emptyStateUserData = userState
    ? {
        shopify_connected: userState.user.shopify_connected,
        first_insight_delivered: userState.user.first_insight_delivered,
      }
    : undefined;

  // Combined "real" loading (excluding the post-sync skeleton flag)
  const isLoading = isStateLoading;

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

  // 2) Normal loading / sync in progress
  if (isLoading || forceLoadingSkeleton) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} />
      </Box>
    );
  }

  // 3) No integration yet → show empty dashboard (WELCOME + CTA)
  if (!userState?.user.shopify_connected) {
    return (
      <EmptyDashboardState
        onConnectStore={onConnectStore}
        userState={emptyStateUserData}
      />
    );
  }

  // 4) Fully ready: render the actual dashboard widgets
  /* console.log('[DashboardStateManager] Rendering dashboard children (widgets).'); */
  return (
    <Box sx={{ p: 2 }}>
      {children}
    </Box>
  );
};