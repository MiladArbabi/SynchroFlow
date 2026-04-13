// ShopLifecycleGate.tsx
//
// PURE structural gate.
// Owns whether children are allowed to exist.

import React from 'react';
import { EmptyDashboardState } from 'components/EmptyStates/EmptyDashboardState';
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

  /**
   * F-01 FIX — IMMEDIATE LOADER ON INTEGRATION PRESENT
   * ---------------------------------------------------
   * integration.hasIntegration is resolved from IntegrationProvider
   * which polls independently of lifecycle — it resolves faster.
   *
   * When OAuth has completed (hasIntegration = true) but lifecycle
   * poll has not yet returned FT0, show the loader immediately.
   *
   * This eliminates the 3-5s blank screen between OAuth success
   * and the first FT0 lifecycle poll response.
   *
   * Gate: only apply during FT_MINUS_ONE — other phases have
   * their own explicit rendering paths.
   */
  if (
    phase === 'FT_MINUS_ONE' &&
    integration.bootResolved &&
    integration.hasIntegration
  ) {
    return <EmptyDashboardState />;
  };

  
  switch (phase) {
    case 'FT_MINUS_ONE': {
      /**
       * FT_MINUS_ONE — pass through to LifecycleRouteHost.
       * WelcomePage is rendered there — no activation config needed.
       * If integration exists but lifecycle hasn't advanced yet,
       * show loader while backend catches up.
       */
      if (integrationExists) {
        return <EmptyDashboardState />;
      }

      return <>{children}</>;
    }

    case 'FT0':
    case 'FT0_SYNCING':
    case 'FT0_PREPARING':
      return <EmptyDashboardState />;

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
