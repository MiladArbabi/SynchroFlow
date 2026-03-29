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

  const { phase, isBooting, integrationExists } = useShopLifecycle();
  const location = useLocation();

  /**
   * REFRESH FLASH HARD GUARD
   * ------------------------
   * Prevent activation surfaces from rendering
   * during lifecycle bootstrap.
   *
   * Without this, FT_MINUS_ONE activation UI
   * can flash for module routes before FT2 sync.
   */
  if (isBooting) {
    return null;
  }


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

      /**
       * 🔥 PRE-FT0 LOADER (CORRECT LAYER)
       * --------------------------------
       * Backend FT0 is delayed (ingestion-driven).
       * Show loader immediately once system interaction begins.
       *
       * Signal:
       * - integration exists → lifecycle has started progressing
       */
      if (integrationExists) {
        console.warn('[LOADER_MOUNT_PRE_FT0]', {
          ts: performance.now(),
        });

        return <EmptyDashboardState />;
      }

      const activationConfig = resolveActivationConfig(moduleId);

      if (!activationConfig) {
        return null;
      }

      return (
        <ActivationSurfaceAdapter
          surface={activationConfig}
          onAction={onActivation}
        />
      );
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
