/* eslint-disable @typescript-eslint/no-unused-vars */
// ShopLifecycleGate.tsx
//
// PURE structural switch.
// NO timers.
// NO effects.
// NO lifecycle logic.

import { Outlet, useLocation } from 'react-router-dom';
import { useShopLifecycle } from './ShopLifecycleContext';

import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { resolveActivationConfig } from 'activation/resolveActivationConfig';

export function ShopLifecycleGate({
  phase,
}: {
  phase: 'FT_MINUS_ONE' | 'FT0_SYNCING' | 'FT0_PREPARING' | 'FT1_READY';
}) {
  const location = useLocation();

  const moduleId = (() => {
    const path = location.pathname;
    if (path.startsWith('/orders')) return 'orders';
    if (path.startsWith('/products')) return 'products';
    if (path.startsWith('/customers')) return 'customers';
    if (path.startsWith('/analytics')) return 'analytics';
    if (path.startsWith('/finances')) return 'finances';
    return 'dashboard';
  })();

  switch (phase) {
    case 'FT_MINUS_ONE': {
      const activationConfig =
        resolveActivationConfig(moduleId);

      return (
        <ActivationSurfaceAdapter
          surface={activationConfig}
          onAction={() =>
            window.dispatchEvent(
              new Event('ui:connect-store')
            )
          }
        />
      );
    }

    case 'FT0_SYNCING':
    case 'FT0_PREPARING':
      return <EmptyDashboardState />;

    case 'FT1_READY':
      return <Outlet />;

    default:
      return null;
  }
}
