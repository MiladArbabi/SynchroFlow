// apps/frontend/src/lifecycle/LifecycleShell.tsx

import React from 'react';
import { useActivationSurface } from 'activation/useActivationSurface';
import { DataSyncingModal } from 'components/DataSyncingModal';

interface LifecycleShellProps {
  children: React.ReactNode;
}

export function LifecycleShell({ children }: LifecycleShellProps) {
  const { surface, isLoading, dismissFT0Modal } = useActivationSurface();

  // Loading = do not render anything yet
    if (isLoading || !surface) {
        return <div />; // or <DashboardSkeletons /> later
    }

  // FT0 syncing modal is a lifecycle concern (session UX)
  const shouldShowFT0Modal =
    surface.state === 'SYNC_IN_PROGRESS';

  return (
    <>
      {shouldShowFT0Modal && (
        <DataSyncingModal
          open
          onClose={dismissFT0Modal}
        />
      )}

      {/* Only render children when ACTIVE or READY */}
      {surface.state === 'ACTIVE' ||
      surface.state === 'READY_PENDING_MODULES'
        ? children
        : null}
    </>
  );
}
