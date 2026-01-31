//apps/frontend/src/lifecycle/lifecycleEffects.ts
import { useEffect, useRef } from 'react';
import { LifecycleEvent, LifecycleState } from './lifecycleTypes';

const FT0_MIN_DWELL_MS = 2500;

type Dispatch = (event: LifecycleEvent) => void;

type EffectsInput = {
  state: LifecycleState;
  dispatch: Dispatch;
  shopId: number | null;
};

export function useLifecycleEffects({
  state,
  dispatch,
  shopId,
}: EffectsInput) {
  /* -------------------------------------------------- */
  /* FT0 dwell timer                                    */
  /* -------------------------------------------------- */

  const ft0TimerRef = useRef<number | null>(null);

  useEffect(() => {
  // FT2 is terminal — no FT0 semantics allowed
  if (state.hasLatchedFT2) return;

    // 🔒 If FT1 is already latched, SKIP dwell immediately
    if (
      state.hasLatchedFT1 &&
      state.phase === 'FT0_PREPARING' &&
      !state.ft0DwellCompleted
    ) {
      dispatch({ type: 'FT0_DWELL_ELAPSED' });
      return;
    }

    if (state.phase !== 'FT0_PREPARING') return;
    if (state.ft0DwellCompleted) return;

    if (ft0TimerRef.current != null) return;

    ft0TimerRef.current = window.setTimeout(() => {
      dispatch({ type: 'FT0_DWELL_ELAPSED' });
      ft0TimerRef.current = null;
    }, FT0_MIN_DWELL_MS);

    return () => {
      if (ft0TimerRef.current) {
        clearTimeout(ft0TimerRef.current);
        ft0TimerRef.current = null;
      }
    };
  }, [
    state.phase,
    state.ft0DwellCompleted,
    state.hasLatchedFT1,
    state.hasLatchedFT2,
    dispatch,
  ]);

  /* -------------------------------------------------- */
  /* FT1 seal persistence                               */
  /* -------------------------------------------------- */

  useEffect(() => {
    if (!shopId) return;

    const key = `shop:${String(shopId)}:ft1-seen`;

    if (state.phase === 'FT1_READY' && state.hasLatchedFT1) {
      /* console.info('[LIFECYCLE][SEAL_WRITE]', {
        phase: state.phase,
        shopId,
      }); */
      localStorage.setItem(key, 'true');
      return;
    }

    if (!state.integrationExists) {
      localStorage.removeItem(key);
    }
  }, [state.phase, state.hasLatchedFT1, state.integrationExists, shopId]);

  /* -------------------------------------------------- */
  /* FT2 seal persistence                               */
  /* -------------------------------------------------- */

  useEffect(() => {
    if (!shopId) return;

    const key = `shop:${String(shopId)}:ft2-seen`;

    if (state.phase === 'FT2_READY' && state.hasLatchedFT2) {
      /* console.info('[LIFECYCLE][SEAL_WRITE]', {
        phase: state.phase,
        shopId,
      }); */
      localStorage.setItem(key, 'true');
      return;
    }

    if (!state.integrationExists) {
      localStorage.removeItem(key);
    }
  }, [
    state.phase,
    state.hasLatchedFT2,
    state.integrationExists,
    shopId,
  ]);

  /* -------------------------------------------------- */
  /* FT1 seal restore (init)                            */
  /* -------------------------------------------------- */

  useEffect(() => {
    if (!shopId) return;
    if (!state.integrationExists) return;

    /* const key = `shop:${shopId}:ft1-seen`;
    const sealed = localStorage.getItem(key) === 'true'; */

    // Seals are observational only
    // No lifecycle mutation allowed
  }, [shopId, state.integrationExists]); // intentionally minimal
}