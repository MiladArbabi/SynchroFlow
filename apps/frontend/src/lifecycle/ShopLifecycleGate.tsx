// ShopLifecycleGate.tsx
//
// PURE structural switch.
// NO timers.
// NO effects.
// NO lifecycle logic.

import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { resolveActivationConfig } from 'activation/resolveActivationConfig';

import { useShopLifecycle } from './ShopLifecycleContext';

export function ShopLifecycleGate() {
  const { phase } = useShopLifecycle();

  const moduleId = 'dashboard';

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
    case 'FT2_READY':
      return null;

    default: {
      if (import.meta.env.DEV) {
        throw new Error(
          `[Lifecycle Violation] Unhandled UILifecyclePhase in ShopLifecycleGate: ${phase}`
        );
      }
      return null;
    }
  }
}
