/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/lifecycle/DashboardLifecycleShell.tsx

import React from 'react';
import { useDashboardState } from 'contexts/DashboardStateContext';
import { useShopLifecycle } from './ShopLifecycleContext';

interface DashboardLifecycleShellProps {
  children: React.ReactNode;
}

export function DashboardLifecycleShell({
  children,
}: DashboardLifecycleShellProps) {
  const { phase: shopPhase } = useShopLifecycle();

  if (import.meta.env.DEV && shopPhase !== 'FT1_READY') {
    throw new Error(
      '[DashboardLifecycleShell] Mounted before FT1_READY. ' +
      'ShopLifecycleGate must prevent this.'
    );
  }

  // No readiness gating.
  // No skeletons.
  // No fades.
  // If dashboard data is loading, widgets handle that themselves.

  return <>{children}</>;
}
