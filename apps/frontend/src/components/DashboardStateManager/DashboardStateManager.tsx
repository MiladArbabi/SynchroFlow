// apps/frontend/src/components/DashboardStateManager/DashboardStateManager.tsx

/**
 * HARD GUARANTEE:
 * This component MUST NEVER render dashboard widgets
 * unless the user has fully exited FT0.
 *
 * Conditions required to render children:
 * - shopify_connected === true
 * - first_insight_delivered === true
 *
 * Activation orchestration lives elsewhere.
 * This component is a safety gate.
 */

import * as React from 'react';
import { Box, Skeleton } from '@mui/material';
import { useDashboardState } from '../../contexts/DashboardStateContext';
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
  const { userState, isLoading } = useDashboardState();

  const emptyStateUserData = userState
    ? {
        shopify_connected: userState.user.shopify_connected,
        first_insight_delivered: userState.user.first_insight_delivered,
      }
    : undefined;

  // ---------------------------------------------------------------------------
  // 1) Loading or forced skeleton → NEVER render children
  // ---------------------------------------------------------------------------
  if (isLoading || forceLoadingSkeleton) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} />
      </Box>
    );
  }

  // ---------------------------------------------------------------------------
  // 2) No integration yet → FT-1
  // ---------------------------------------------------------------------------
  if (!userState?.user.shopify_connected) {
    return (
      <EmptyDashboardState
        onConnectStore={onConnectStore}
        userState={emptyStateUserData}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // 3) FT0 ANALYZING → ABSOLUTE BLOCK
  // ---------------------------------------------------------------------------
  if (!userState.user.first_insight_delivered) {
    return (
      <EmptyDashboardState
        onConnectStore={onConnectStore}
        userState={emptyStateUserData}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // 4) FT1 → SAFE TO RENDER DASHBOARD
  // ---------------------------------------------------------------------------
  return (
    <Box sx={{ p: 2 }}>
      {children}
    </Box>
  );
};
