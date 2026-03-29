/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
// apps/frontend/src/lifecycle/LifecycleProvider.tsx
import React, { useEffect, useReducer } from 'react';
import { ShopLifecycleContext } from './ShopLifecycleContext';
import { lifecycleReducer } from './lifecycleReducer';
import { UILifecyclePhase } from './types';
import { useIntegration } from 'contexts/integration';
import { useAuth } from 'contexts/AuthContext';
import { axiosInstance } from 'api/axiosConfig';
import { useLifecycleEffects } from './lifecycleEffects';
import { deriveInitialLifecycleState } from './deriveInitialLifecycleState';
import { getFt2Readiness } from 'api/lifecycle';

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
}: LifecycleProviderProps) {
  
  const { user, isLoading: authLoading } = useAuth();
  const shopId = user?.shop_id ?? null;

  const initialState = React.useMemo(
      () => deriveInitialLifecycleState(shopId),
    []
  );

  const [state, dispatch] = useReducer(lifecycleReducer, initialState);
  const [isResolved, setIsResolved] = React.useState(false);

  const integration = useIntegration();
  const [ft2RestoreResolved, setFt2RestoreResolved] = React.useState(false);
  // 🔥 GLOBAL READINESS STATE (single source of truth)
  const [readiness, setReadiness] = React.useState<null | { ready: boolean }>(null);

  const hasFT2Seal =
    shopId != null &&
    localStorage.getItem(`shop:${shopId}:ft2-seen`) === 'true';

  /**
   * ❌ REMOVED: Integration-driven lifecycle mutation
   * -----------------------------------------------
   * Integration state must NOT control lifecycle phase.
   * Backend lifecycle projection is the ONLY authority.
   *
   * Retained for observability only.
   */
  useEffect(() => {
    if (!integration.bootResolved) return;

    if (integration.hasIntegration) {
      console.info('[INTEGRATION_SIGNAL_OBSERVED]', {
        hasIntegration: integration.hasIntegration,
      });
    }
  }, [integration.bootResolved, integration.hasIntegration]);

  /**
   * ❌ REMOVED: One-time lifecycle fetch
   * -----------------------------------
   * Lifecycle must be driven ONLY by polling.
   *
   * Having both:
   * - initial fetch
   * - polling
   *
   * creates:
   * - race conditions
   * - duplicate dispatch
   *
   * Polling is the single source of truth.
   */
  useEffect(() => {
    if (authLoading || !user) {
      console.info('[LIFECYCLE][BLOCKED_NO_AUTH]', {
        authLoading,
        hasUser: !!user,
      });
      return;
    }

    console.info('[LIFECYCLE][POLLING_WILL_HANDLE_FETCH]', {
      shopId: user?.shop_id,
    });

    /**
     * INTENTIONALLY NO-OP
     * -------------------
     * Boot resolution now occurs only after the first
     * successful lifecycle poll response.
     */

  }, [authLoading, user?.shop_id]);

    /**
   * 🔥 IMMEDIATE LIFECYCLE SYNC (CRITICAL FIX)
   * -----------------------------------------
   * Ensures lifecycle is fetched immediately on mount,
   * removing dependency on polling interval.
   *
   * This is SAFE because:
   * - Does NOT replace polling
   * - Does NOT create race (same endpoint, idempotent dispatch)
   * - Only accelerates first detection
   *
   * Without this:
   * - FT_MINUS_ONE → FT0 waits up to 3s+
   */
  useEffect(() => {
    if (!shopId || authLoading) return;

    console.info('[LIFECYCLE_IMMEDIATE_SYNC_TRIGGER]', {
      shopId,
      authLoading,
      ts: performance.now(),
    });

    let cancelled = false;

    async function immediateFetch() {
      try {
        const res = await axiosInstance.get('/api/v1/lifecycle');
        const backendPhase = res?.data?.phase;

        if (!cancelled) {
          dispatch({
            type: 'BACKEND_PHASE_SYNC',
            phase: backendPhase,
          });

          /**
           * 🔥 BOOT RESOLUTION (SOURCE OF TRUTH)
           * -----------------------------------
           * Any successful lifecycle sync MUST resolve boot.
           * Prevents UI lock when polling is bypassed.
           */
          setIsResolved(true);

          console.info('[LIFECYCLE_RESOLVE_ON_IMMEDIATE]', {
            backendPhase,
            ts: performance.now(),
          });
        }
      } catch (err) {
        console.error('[LIFECYCLE_IMMEDIATE_SYNC_FAILED]', err);
      }
    }

    immediateFetch();

    return () => {
      cancelled = true;
    };
  }, [shopId, authLoading]);

  /**
   * ❌ NO FRONTEND LIFECYCLE EVENTS
   * ------------------------------
   * Lifecycle transitions must NEVER be triggered via window events.
   * Backend polling is the ONLY source of truth.
   */

  const isHydratedTerminal =
    state.phase === 'FT1_READY' || state.phase === 'FT2_READY';

  useEffect(() => {
    if (!shopId) return;

    let cancelled = false;

    async function loadReadiness() {
      try {
        const res = await getFt2Readiness();

        /**
         * ⚠️ REMOVED: lifecycle fetch from readiness effect
         * ------------------------------------------------
         * Readiness must NOT fetch lifecycle.
         * Lifecycle polling is the ONLY source.
         */
        console.log('[AUDIT][READINESS_ONLY]', {
          readiness: res,
          ts: performance.now(),
        });

        console.info('[LIFECYCLE][READINESS_SYNC]', {
          ready: res?.ready,
          ts: performance.now(),
        });

        if (!cancelled) {
          setReadiness(res);
        }
      } catch (err) {
        console.error('[LIFECYCLE][READINESS_FAILED]', err);
      }
    }

    loadReadiness();
    const i = setInterval(loadReadiness, 3000);

    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [shopId]);

  /**
   * 🔥 LIFECYCLE POLLING (SOURCE OF TRUTH)
   * -------------------------------------
   * Continuously sync lifecycle from backend.
   *
   * REQUIRED because:
   * - lifecycle progresses asynchronously
   * - frontend must stay reactive
   *
   * This replaces ALL readiness-based triggering.
   */
  useEffect(() => {
    if (!shopId) return;

    /**
     * ⚠️ DO NOT GATE LIFECYCLE POLLING
     * --------------------------------
     * Backend lifecycle must be polled regardless of integration state.
     *
     * Gating causes:
     * - missed transitions (FT_MINUS_ONE → FT0 → FT1)
     * - UI stuck until refresh
     */

    let cancelled = false;

    async function pollLifecycle() {
      try {
        const res = await axiosInstance.get('/api/v1/lifecycle');
        const backendPhase = res?.data?.phase;

        if (!cancelled) {
          dispatch({
            type: 'BACKEND_PHASE_SYNC',
            phase: backendPhase,
          });

          setIsResolved(true);

          console.info('[LIFECYCLE_RESOLVE_ON_POLL]', {
            backendPhase,
            ts: performance.now(),
          });
        }
      } catch (err) {
        console.error('[LIFECYCLE_POLL_FAILED]', err);
      }
    }

    /**
     * FIRST-PAINT FLASH FIX
     * ---------------------
     * Resolve boot only after first authoritative
     * lifecycle snapshot returns from backend.
     */
    async function pollAndResolve() {
      await pollLifecycle();
      setIsResolved(true);
    }

    pollAndResolve();
        /**
     * 🔥 TRANSITION-TRIGGERED SYNC (CRITICAL)
     * --------------------------------------
     * If we are in FT_MINUS_ONE, aggressively re-check lifecycle
     * to eliminate polling delay window.
     *
     * This creates a short-lived fast-sync loop ONLY during activation.
     */
    if (state.phase === 'FT_MINUS_ONE') {
      console.warn('[LIFECYCLE_FAST_SYNC_ARMED]', {
        phase: state.phase,
      });

      let cancelled = false;

      const fastLoop = async () => {
        if (cancelled) return;

        try {
          const res = await axiosInstance.get('/api/v1/lifecycle');
          const backendPhase = res?.data?.phase;

          console.info('[LIFECYCLE_FAST_SYNC_TICK]', {
            backendPhase,
            ts: performance.now(),
          });

          if (backendPhase !== 'FT_MINUS_ONE') {
            dispatch({
              type: 'BACKEND_PHASE_SYNC',
              phase: backendPhase,
            });

            setIsResolved(true);

            console.info('[LIFECYCLE_RESOLVE_ON_FAST_SYNC]', {
              backendPhase,
              ts: performance.now(),
            });

            return; // stop loop immediately
          }

          // 🔥 immediate retry (no interval delay)
          fastLoop();
        } catch (err) {
          console.error('[LIFECYCLE_FAST_SYNC_FAILED]', err);
          fastLoop(); // retry on failure
        }
      };

      fastLoop();

      // cleanup hook
      return () => {
        cancelled = true;
      };
    }

    const interval = setInterval(pollLifecycle, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shopId, state.integrationExists]);

  /* ---------------- FT2 restore ---------------- */

  useEffect(() => {
    if (isHydratedTerminal) return;
    
    /**
     * ❌ REMOVED: Frontend-driven FT2 restore
     * --------------------------------------
     * FT2 must ONLY come from backend lifecycle.
     * LocalStorage cannot mutate lifecycle phase.
     *
     * Retained ONLY for audit visibility.
     */
    if (hasFT2Seal && integration.hasIntegration) {
      console.warn('[FT2_RESTORE_IGNORED_FRONTEND]', {
        reason: 'frontend cannot set lifecycle phase',
      });

      setFt2RestoreResolved(true);
      return;
    }

    if (hasFT2Seal && !integration.hasIntegration && shopId) {
      localStorage.removeItem(`shop:${shopId}:ft2-seen`);
    }

    if (!state.bootResolved) return;
    if (!state.integrationExists) return;
    if (!shopId) return;

    let cancelled = false;

    async function restoreFT2() {
      try {
        console.log('[FT2_RESTORE_FROM_API]');

        // FT2 evaluation is advisory only
        // Lifecycle phase must be set by backend confirm
      } finally {
        if (!cancelled) {
          setFt2RestoreResolved(true);
        }
      }
    }

    restoreFT2();

    return () => {
      cancelled = true;
    };
  }, [
    integration.bootResolved,
    integration.hasIntegration,
    shopId,
    hasFT2Seal,
  ]);

  /* ---------------- Side effects ---------------- */

  useLifecycleEffects({
    state,
    dispatch,
    shopId,
  });

  /**
   * CRITICAL: HARD PRE-RENDER GUARD
   * --------------------------------
   * Prevent ANY render (even logging) before lifecycle is resolved.
   * This eliminates first-frame FT_MINUS_ONE leakage.
   */
  if (!isResolved) {
    console.info('[LIFECYCLE_PROVIDER_BOOT_BLOCK]', {
      phase: state.phase,
      ts: performance.now(),
    });

    return null;
  }

  const isBooting = false;

  console.log('[LIFECYCLE_PROVIDER_RENDER]', {
    phase: state.phase,
    readiness,
    isResolved,
  });

  return (
    <ShopLifecycleContext.Provider 
      value={{
        ...state,
        readiness, // expose globally
        isBooting,
      }}
    >
      {children}
    </ShopLifecycleContext.Provider>
  );
}