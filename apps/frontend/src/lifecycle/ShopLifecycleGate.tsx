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
import { Outlet, useLocation } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

import { DataSyncingModal } from 'components/DataSyncingModal';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { resolveActivationConfig } from 'activation/resolveActivationConfig';

export function ShopLifecycleGate() {
  const { phase } = useShopLifecycle();
  const location = useLocation();

  /**
   * Resolve moduleId from route.
   * STRUCTURAL only — no business logic.
   */
  const moduleId = (() => {
    const path = location.pathname;

    if (path.startsWith('/orders')) return 'orders';
    if (path.startsWith('/products')) return 'products';
    if (path.startsWith('/customers')) return 'customers';
    if (path.startsWith('/analytics')) return 'analytics';
    if (path.startsWith('/finances')) return 'finances';

    return 'dashboard';
  })();

  if (import.meta.env.DEV) {
    console.debug('[ShopLifecycleGate]', {
      phase,
      moduleId,
      path: location.pathname,
    });
  }

  switch (phase) {
    case 'FT_MINUS_ONE': {
      const activationConfig = resolveActivationConfig(moduleId);

      return (
        <ActivationSurfaceAdapter
          surface={activationConfig}
          onAction={() =>
            window.dispatchEvent(new Event('ui:connect-store'))
          }
        />
      );
    }

    case 'FT0_SYNCING':
      return <DataSyncingModal open onClose={() => {}} />;

    case 'FT0_PREPARING':
      return (
        <EmptyDashboardState
          onConnectStore={() =>
            window.dispatchEvent(new Event('ui:connect-store'))
          }
        />
      );

    case 'FT1_READY':
      return <Outlet />;

    default:
      return null;
  }
}
