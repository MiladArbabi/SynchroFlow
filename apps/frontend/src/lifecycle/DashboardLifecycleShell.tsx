// apps/frontend/src/lifecycle/DashboardLifecycleShell.tsx

import React from 'react';

import { dashboardActivationConfig } from 'activation/configs/dashboard';
import { useDashboardState } from 'contexts/DashboardStateContext';

import { GenericLifecycleShell } from './GenericLifecycleShell';

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

interface DashboardLifecycleShellProps {
  children: React.ReactNode;
  onActivate: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * DashboardLifecycleShell
 * -----------------------
 *
 * INVARIANTS:
 * - Shop lifecycle is already resolved by ShopLifecycleShell
 * - This shell NEVER decides FT_MINUS_ONE / FT0 / FT1
 *
 * RESPONSIBILITY:
 * - Provide dashboard-specific readiness ONLY
 */
export function DashboardLifecycleShell({
  children,
  onActivate,
}: DashboardLifecycleShellProps) {
  const { currentView } = useDashboardState();

  /**
   * Dashboard readiness:
   * - empty → NOT ready
   * - hydrated → ready
   */
  const isReady = currentView !== 'empty';

  if (import.meta.env.DEV) {
    console.debug('[DashboardLifecycleShell]', {
      isReady,
    });
  }

  return (
    <GenericLifecycleShell
      scopeId="dashboard"
      activationConfig={dashboardActivationConfig}
      backendPhase="FT1"
      activationState="ACTIVE"
      isReady={isReady}
      onActivate={() => onActivate()}
    >
      {children}
    </GenericLifecycleShell>
  );
}
