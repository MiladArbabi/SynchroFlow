// ShopLifecycleGate.tsx
//
// PURE structural gate.
// Owns whether children are allowed to exist.

import React from 'react';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { resolveActivationConfig } from 'activation/resolveActivationConfig';
import { useShopLifecycle } from './ShopLifecycleContext';

type Props = {
  children: React.ReactNode;
};

export function ShopLifecycleGate({ children }: Props) {
  const { phase } = useShopLifecycle();

  // NOTE: moduleId will be routed properly later
  const moduleId = 'dashboard';

  switch (phase) {
    case 'FT_MINUS_ONE': {
      const activationConfig = resolveActivationConfig(moduleId);

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
      return <>{children}</>;

    case 'FT2_READY':
      // FT2 routes will be mounted explicitly later
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
