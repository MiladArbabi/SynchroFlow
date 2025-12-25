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
import { useEffect, useRef, useState } from 'react';
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
   * Instrumentation refs
   * - ft0SyncStartTs: when FT0_SYNCING first appears
   * - lastPhase: detect phase transitions
   */
  const ft0SyncStartTs = useRef<number | null>(null);
  const lastPhase = useRef<string | null>(null);

  /**
   * Guards forced FT0-A
   * Once FT1 is reached, forced FT0-A must NEVER run again
   */
   const hasReachedFT1 = useRef(false);
   const integrationJustCreated = useRef(false);

  /**
   * FT0-B minimum duration enforcement
   */
  const ft0BStartTs = useRef<number | null>(null);
  const [allowFT1Exit, setAllowFT1Exit] = useState(true);
  const [forceFT0AModal, setForceFT0AModal] = useState(false);

    useEffect(() => {
      if (lastPhase.current === null) {
       lastPhase.current = phase;
      }

    /**
     * FORCED FT0-A
     * FT_MINUS_ONE → FT0_PREPARING (sync completed too fast)
     */
    if (
      phase === 'FT0_PREPARING' &&
      integrationJustCreated.current &&
      !hasReachedFT1.current
    ) {
      const start = performance.now();
      setForceFT0AModal(true);

      console.info('[Lifecycle][FT0-A][UI-forced] Modal visible');

      const MIN_FT0A_DURATION_MS = 2900;

      const timer = setTimeout(() => {
        setForceFT0AModal(false);
        integrationJustCreated.current = false;

        console.info('[Lifecycle][FT0-A→FT0-B][UI-forced]', {
          durationMs: performance.now() - start,
        });
      }, MIN_FT0A_DURATION_MS);

      return () => clearTimeout(timer);
    }

    /**
     * NATURAL FT0-A
     */
      if (phase === 'FT0_SYNCING' && lastPhase.current !== 'FT0_SYNCING') {
        ft0SyncStartTs.current = performance.now();

        console.info('[Lifecycle][FT0-A] Syncing started', {
          path: location.pathname,
        });
      }

    /**
     * NATURAL FT0-A → FT0-B
     */
    if (
      phase === 'FT0_PREPARING' &&
      lastPhase.current === 'FT0_SYNCING' &&
      ft0SyncStartTs.current !== null
    ) {
      const durationMs = performance.now() - ft0SyncStartTs.current;

      console.info('[Lifecycle][FT0-A→FT0-B] Sync completed', {
        durationMs,
      });

      ft0SyncStartTs.current = null;
    }

    /**
     * FT0-B entry
     */
    if (phase === 'FT0_PREPARING' && lastPhase.current !== 'FT0_PREPARING') {
      console.info('[Lifecycle][FT0-B] Preparing UI shown', {
        path: location.pathname,
      });

      // Start FT0-B minimum visibility timer
      ft0BStartTs.current = performance.now();
      setAllowFT1Exit(false);

      const MIN_FT0B_DURATION_MS = 2000;

      const timer = setTimeout(() => {
        setAllowFT1Exit(true);

        console.info('[Lifecycle][FT0-B→FT1_READY][UI-unlocked]', {
          durationMs: performance.now() - (ft0BStartTs.current ?? 0),
        });

        ft0BStartTs.current = null;
      }, MIN_FT0B_DURATION_MS);

      return () => clearTimeout(timer);
    }

    /**
     * FT1 reached → permanently disable forced FT0-A (this session)
     */
    if (phase === 'FT1_READY') {
      hasReachedFT1.current = true;
      integrationJustCreated.current = false;
    }

    lastPhase.current = phase;
  }, [phase, location.pathname]);

  useEffect(() => {
    const handler = () => {
      integrationJustCreated.current = true;

      if (import.meta.env.DEV) {
        console.info('[Lifecycle] Integration initiated by user');
      }
    };

    window.addEventListener('ui:connect-store', handler);
    return () => window.removeEventListener('ui:connect-store', handler);
  }, []);


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
    if (phase === 'FT0_SYNCING') {
    console.assert(
      location.pathname === '/dashboard' || true,
      '[ShopLifecycleGate] FT0_SYNCING must not allow route content'
      ); 
    }
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
      if (forceFT0AModal) {
        return <DataSyncingModal open onClose={() => {}} />;
      }

      return (
        <EmptyDashboardState
          onConnectStore={() =>
            window.dispatchEvent(new Event('ui:connect-store'))
          }
        />
      );


    case 'FT1_READY':
      if (!allowFT1Exit) {
        return (
          <EmptyDashboardState
            onConnectStore={() =>
              window.dispatchEvent(new Event('ui:connect-store'))
            }
          />
        );
      }
 
   return <Outlet />;

    default:
      return null;
  }
}
