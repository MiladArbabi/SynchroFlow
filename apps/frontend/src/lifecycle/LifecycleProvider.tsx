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

  console.log('[PROVIDER_PHASE]', state.phase);

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

    setIsResolved(true);
  }, [authLoading, user?.shop_id]);

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

          console.info('[LIFECYCLE_POLL_SYNC]', {
            backendPhase,
            ts: performance.now(),
          });
        }
      } catch (err) {
        console.error('[LIFECYCLE_POLL_FAILED]', err);
      }
    }

    pollLifecycle();
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

  if (!state.phase) return null;

  const isBooting = !isResolved;

  if (!state.phase) {
    console.log('[PROVIDER_BLOCKED_NO_PHASE]');
    return null;
  }

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