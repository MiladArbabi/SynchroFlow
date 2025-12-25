/**
 * DashboardLifecycleShell
 * -----------------------
 *
 * MODEL A INVARIANT:
 * - This component MUST ONLY be mounted after FT1_READY.
 * - It must NEVER handle FT_MINUS_ONE or FT0 phases.
 * - Structural lifecycle (existence) is handled by ShopLifecycleGate.
 *
 * If this component mounts before FT1_READY:
 * → the routing architecture is broken.
 */

// apps/frontend/src/lifecycle/DashboardLifecycleShell.tsx

import React from 'react';
import { useDashboardState } from 'contexts/DashboardStateContext';

import { GenericLifecycleShell } from './GenericLifecycleShell';
import { useShopLifecycle } from './ShopLifecycleContext';

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
}: DashboardLifecycleShellProps) {
  const { currentView } = useDashboardState();
  const { phase: shopPhase } = useShopLifecycle();

  if (import.meta.env.DEV && shopPhase !== 'FT1_READY') {
    throw new Error(
      '[DashboardLifecycleShell] Mounted before FT1_READY. ' +
      'Structural lifecycle gating is broken.'
    );
  }

  const isReady = currentView !== 'empty';

  return (
    <GenericLifecycleShell
      scopeId="dashboard"
      backendPhase="FT1"
      isReady={isReady}
    >
      {children}
    </GenericLifecycleShell>
  );
}