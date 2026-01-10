// ShopLifecycleGate.tsx
//
// PURE structural gate.
// Owns whether children are allowed to exist.

import React from 'react';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
import { ActivationSurfaceAdapter } from 'activation/ActivationSurfaceAdapter';
import { resolveActivationConfig } from 'activation/resolveActivationConfig';
import { useShopLifecycle } from './ShopLifecycleContext';
import { useLocation } from 'react-router-dom';

type Props = {
  children: React.ReactNode;
  onActivation: (actionId: string) => void;
};

export function ShopLifecycleGate({ children, onActivation }: Props) {
  const { phase } = useShopLifecycle();

  const location = useLocation();

const moduleId =
  location.pathname.split('/')[1] || 'dashboard';

  switch (phase) {
    case 'FT_MINUS_ONE': {
      const activationConfig = resolveActivationConfig(moduleId);

      return (
        <ActivationSurfaceAdapter
          surface={activationConfig}
          onAction={onActivation}
        />
      );
    }

    case 'FT0_SYNCING':
    case 'FT0_PREPARING':
      return <EmptyDashboardState />;

    case 'FT1_READY':
      return <>{children}</>;

    case 'FT2_READY':
      return <>{children}</>;


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
