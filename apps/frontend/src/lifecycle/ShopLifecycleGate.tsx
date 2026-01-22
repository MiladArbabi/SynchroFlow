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

  const rawSegment = location.pathname.split('/')[1];

  /**
   * Module identity is derived directly from the first route segment.
   * No synthetic remapping is allowed.
   *
   * Routing decides WHICH surface mounts.
   * Activation config decides WHAT renders.
   */
  const moduleId = rawSegment;

  
  switch (phase) {
    case 'FT_MINUS_ONE': {
      console.log(
        '[FT_MINUS_ONE][MODULE_ID]',
        location.pathname,
        moduleId
      );
    const activationConfig = resolveActivationConfig(moduleId);

    if (!activationConfig) {
      /**
       * Defensive fallback:
       * FT_MINUS_ONE must never infer or redirect.
       */
      return null;
    }

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
