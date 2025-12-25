// apps/frontend/src/lifecycle/ShopLifecycleGate.tsx

import React from 'react';
import { Outlet } from 'react-router-dom';

import { useShopLifecycle } from './ShopLifecycleContext';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { dashboardActivationConfig } from 'activation/configs/dashboard';
import { DataSyncingModal } from 'components/DataSyncingModal';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';

/**
 * ShopLifecycleGate
 * -----------------
 *
 * STRUCTURAL gate.
 *
 * Decides WHICH subtree exists based on shop lifecycle phase.
 * This is the ONLY place allowed to block routes.
 *
 * Rules:
 * - FT_MINUS_ONE   → activation surface (dashboard config)
 * - FT0_SYNCING    → blocking sync modal
 * - FT0_PREPARING  → empty dashboard state
 * - FT1_READY      → real app routes (Outlet)
 */
export function ShopLifecycleGate() {
  const { phase } = useShopLifecycle();

  if (import.meta.env.DEV) {
    console.debug('[ShopLifecycleGate]', { phase });
  }

  switch (phase) {
    case 'FT_MINUS_ONE':
      return (
        <ActivationSurfaceAdapter
          surface={dashboardActivationConfig}
          onAction={() => {
            window.dispatchEvent(new Event('ui:connect-store'));
          }}
        />
      );

    case 'FT0_SYNCING':
      return <DataSyncingModal open onClose={()=>{}} />;

    case 'FT0_PREPARING':
      return (
        <EmptyDashboardState
          onConnectStore={() => {
            window.dispatchEvent(new Event('ui:connect-store'));
          }}
        />
      );

    case 'FT1_READY':
      return <Outlet />;

    default:
      return null;
  }
}