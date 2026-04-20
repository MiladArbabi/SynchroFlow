// ShopLifecycleGate.tsx
//
// PURE structural gate.
// Owns whether children are allowed to exist.

import React from 'react';
import { useShopLifecycle } from './ShopLifecycleContext';
import { useIntegration } from 'contexts/integration';

type Props = {
  children: React.ReactNode;
  onActivation: (actionId: string) => void;
};

export function ShopLifecycleGate({ children }: Props) {

  const { phase, isBooting, integrationExists } = useShopLifecycle();
  const integration = useIntegration();

  /**
   * REFRESH FLASH HARD GUARD
   * ------------------------
   * Prevent activation surfaces from rendering
   * during lifecycle bootstrap.
   */
  if (isBooting) {
    return null;
  }

  if (
    phase === 'FT_MINUS_ONE' &&
    integration.bootResolved &&
    integration.hasIntegration
  ) {
    // Integration exists but lifecycle hasn't advanced to FT0 yet.
    // Pass through to LifecycleRouteHost — SyncAnimationPage handles this.
    return <>{children}</>;
  };
  
  switch (phase) {
    case 'FT_MINUS_ONE': {
      if (integrationExists) {
        // Lifecycle hasn't caught up yet — pass through, LifecycleRouteHost decides.
        return <>{children}</>;
      }
      return <>{children}</>;
    }
    case 'FT0':
    case 'FT0_SYNCING':
    case 'FT0_PREPARING':
      // Pass through — SyncAnimationPage in LifecycleRouteHost owns this phase.
      return <>{children}</>;

    /**
     * ✅ FT1 lifecycle (no readiness required)
     * Must render FT1 surfaces immediately
     */
    case 'FT1':
    case 'FT1_READY':
      return <>{children}</>;

    case 'FT2_READY':
      return <>{children}</>;

    default: {
      console.error('[LIFECYCLE][UNHANDLED_PHASE]', { phase });

      /**
       * 🚨 HARD GUARD
       * Prevent silent blank screen
       */
      return (
        <div style={{ padding: 24 }}>
          <h3>UI rendering error</h3>
          <pre>{String(phase)}</pre>
        </div>
      );
    }
  }
}
