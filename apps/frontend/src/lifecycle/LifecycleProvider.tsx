// apps/frontend/src/lifecycle/LifecycleProvider.tsx
import React from 'react';
import { ShopLifecycleContext } from './ShopLifecycleContext';
import { UILifecyclePhase } from './types';
import { getLifecycle } from 'api/lifecycle';

type LifecycleProviderProps = {
  children: React.ReactNode;

  /**
   * TEST ONLY:
   * Allows deterministic lifecycle injection.
   * When provided, NO network request is made.
   */
  initialPhase?: UILifecyclePhase;
};

/**
 * LifecycleProvider
 * -----------------
 * Single authority for frontend lifecycle truth.
 *
 * Responsibilities:
 * - Fetch /api/v1/lifecycle
 * - Map backend → UI lifecycle phase
 * - Provide lifecycle context
 *
 * Non-responsibilities:
 * - Rendering decisions
 * - FT1 / FT2 UX
 * - Gating logic
 */
export function LifecycleProvider({
  children,
  initialPhase,
}: LifecycleProviderProps) {
  const [phase, setPhase] = React.useState<UILifecyclePhase | null>(
    initialPhase ?? null
  );

  React.useEffect(() => {
    if (initialPhase) {
      console.info('[LifecycleProvider] using injected phase', {
        phase: initialPhase,
      });
      return;
    }

    let alive = true;

    console.info('[LifecycleProvider] fetching lifecycle');

    getLifecycle()
      .then((res) => {
        if (!alive) return;

        const mapped = mapBackendPhase(res.phase);

        console.info('[LifecycleProvider] lifecycle resolved', {
          backendPhase: res.phase,
          uiPhase: mapped,
          ts: performance.now(),
        });

        setPhase(mapped);
      })
      .catch((err) => {
        console.error('[LifecycleProvider] failed to fetch lifecycle', err);
      });

    return () => {
      alive = false;
    };
  }, [initialPhase]);

  if (!phase) {
    return null; // intentional: lifecycle unknown → no UI
  }

  return (
    <ShopLifecycleContext.Provider value={{ phase }}>
      {children}
    </ShopLifecycleContext.Provider>
  );
}

function mapBackendPhase(phase: string): UILifecyclePhase {
  switch (phase) {
    case 'FT_MINUS_ONE':
      return 'FT_MINUS_ONE';
    case 'FT0':
      return 'FT0_PREPARING';
    case 'FT1':
      return 'FT1_READY';
    case 'FT2':
      return 'FT2_READY';
    default:
      throw new Error(
        `[LifecycleProvider] Unknown backend phase: ${phase}`
      );
  }
}