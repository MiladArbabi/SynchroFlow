// apps/frontend/src/components/DashboardStateManager/DashboardStateManager.tsx

import * as React from 'react';
import { Box } from '@mui/material';

import { useActivationSurface } from 'activation/useActivationSurface';
import { EmptyDashboardState } from '../EmptyStates/EmptyDashboardState';
import { DataSyncingModal } from '../DataSyncingModal';
import { DashboardSkeletons } from '../skeletons/DashboardSkeletons';

interface DashboardStateManagerProps {
  onConnectStore: () => void;
  children: React.ReactNode;
}

export const DashboardStateManager: React.FC<DashboardStateManagerProps> = ({
  onConnectStore,
  children,
}) => {
  const { surface, isLoading, dismissFT0Modal } = useActivationSurface({
    moduleId: 'dashboard',
  });

  if (isLoading || !surface) {
    return <DashboardSkeletons />;
  }

  switch (surface.state) {
    case 'BLOCKED_AUTH':
    case 'BLOCKED_SHOP':
    case 'CONNECT_INTEGRATION':
    case 'READY_PENDING_MODULES':
      return <EmptyDashboardState onConnectStore={onConnectStore} />;

    case 'SYNC_IN_PROGRESS':
      return <DataSyncingModal open onClose={dismissFT0Modal} />;

    case 'ACTIVE':
      return <Box sx={{ p: 2 }}>{children}</Box>;

    default:
      return null;
  }
};
