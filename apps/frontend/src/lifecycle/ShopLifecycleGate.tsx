/**
 * ShopLifecycleGate
 * -----------------
 *
 * STRUCTURAL lifecycle controller (MODEL A).
 *
 * Responsibilities:
 * - FT_MINUS_ONE   → Activation surface
 * - FT0_SYNCING    → Blocking modal
 * - FT0_PREPARING  → Empty dashboard
 * - FT1_READY      → Allow real routes to exist
 *
 * This component:
 * - DOES decide structure
 * - DOES render UI pre-FT1
 * - MUST NOT render GenericLifecycleShell
 */

// apps/frontend/src/lifecycle/ShopLifecycleGate.tsx
import { Outlet } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';
import { DataSyncingModal } from 'components/DataSyncingModal';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { dashboardActivationConfig } from 'activation/configs';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';

export function ShopLifecycleGate() {
  const { phase } = useShopLifecycle();

  if (import.meta.env.DEV) {
    console.debug('[ShopLifecycleGate]', phase);
  }

  switch (phase) {
    case 'FT_MINUS_ONE':
      return (
        <ActivationSurfaceAdapter
          surface={dashboardActivationConfig}
          onAction={() =>
            window.dispatchEvent(new Event('ui:connect-store'))
          }
        />
      );

    case 'FT0_SYNCING':
      return <DataSyncingModal open onClose={() => {}} />;

    case 'FT0_PREPARING':
      return <EmptyDashboardState
              onConnectStore={() =>
                window.dispatchEvent(new Event('ui:connect-store'))
              }
            />;

    case 'FT1_READY':
      return <Outlet />;

    default:
      return null;
  }
}
