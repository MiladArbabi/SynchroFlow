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

  const hasFT2Seal =
    shopId != null &&
    localStorage.getItem(`shop:${shopId}:ft2-seen`) === 'true';

  /**
   * 🔗 INTEGRATION → LIFECYCLE BRIDGE
   * --------------------------------
   * Lifecycle must react to integration existence.
   *
   * Without this:
   * - system stays in FT_MINUS_ONE
   * - FT0 never appears
   */
  useEffect(() => {
    if (!integration.bootResolved) return;

    if (integration.hasIntegration) {
      console.info('[LIFECYCLE][INTEGRATION_EXISTS]');

      dispatch({ type: 'BOOT_RESOLVED' });
      dispatch({ type: 'INTEGRATION_CREATED' });
    }
  }, [integration.bootResolved, integration.hasIntegration]);

  /**
   * 🚫 ARCHITECTURE ENFORCEMENT — DO NOT REINTRODUCE
   * -----------------------------------------------
   * Lifecycle MUST NOT be derived from integration.syncStatus.
   *
   * Reason:
   * - sync_status is an EARLY signal (ingestion)
   * - lifecycle is a LATE signal (post-projection truth)
   *
   * Using syncStatus creates:
   * - race conditions
   * - blank UI gaps
   * - dual authority violation
   *
   * Lifecycle is ONLY allowed to come from:
   *   GET /api/v1/lifecycle
   *
   * If FT0 is missing → FIX BACKEND (projection), NOT frontend.
   */
  
  useEffect(() => {

    /**
     * 🔒 AUTH GATE (CRITICAL)
     * ----------------------
     * Lifecycle MUST NOT be fetched until:
     * - auth fully resolved
     * - user exists (token guaranteed)
     *
     * Otherwise:
     * - 401 from backend
     * - lifecycle never updates
     * - UI stuck in FT_MINUS_ONE
     */
    if (authLoading || !user) {
      console.info('[LIFECYCLE][BLOCKED_NO_AUTH]', {
        authLoading,
        hasUser: !!user,
      });
      return;
    }

    console.info('[LIFECYCLE][FETCH_TRIGGER]', {
      shopId: user?.shop_id,
      authLoading,
      hasUser: !!user,
      ts: performance.now(),
    });

    let cancelled = false;

      async function fetchLifecycle() {
      const startedAt = performance.now();

      try {
        const res = await axiosInstance.get('/api/v1/lifecycle');
        const backendPhase = res?.data?.phase;

        console.info('[LIFECYCLE][BACKEND_PHASE_RECEIVED]', {
          backendPhase,
          ts: performance.now(),
        });

        dispatch({
          type: 'BACKEND_PHASE_SYNC',
          phase: backendPhase,
        });
        
      } catch (err) {
        if (err?.response?.status === 401) {
          console.error('[LIFECYCLE][AUTH_MISSING_TOKEN]', {
            error: err,
          });
        } else {
          console.error('[LIFECYCLE][SYNC][FAILED]', {
            source: 'backend',
            durationMs: Math.round(performance.now() - startedAt),
            error: err,
          });
        }
      } finally {
        if (!cancelled) {
          setIsResolved(true);
        }
      }
    }

    fetchLifecycle();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.shop_id]);

  useEffect(() => {
    function onFt2Confirmed() {
      console.info('[LIFECYCLE][FT2][EVENT_RECEIVED]');
      dispatch({ type: 'FT2_BACKEND_COMPLETE' });
    }

    window.addEventListener('lifecycle:ft2-confirmed', onFt2Confirmed);
    return () => {
      window.removeEventListener('lifecycle:ft2-confirmed', onFt2Confirmed);
    };
  }, []);

  useEffect(() => {
    async function refetchLifecycle() {
      console.info('[LIFECYCLE][MANUAL_REFRESH_TRIGGERED]', {
        ts: performance.now(),
      });

      try {
        const res = await axiosInstance.get('/api/v1/lifecycle');
        const backendPhase = res?.data?.phase;

        console.info('[LIFECYCLE][MANUAL_REFRESH_RESULT]', {
          backendPhase,
        });

        dispatch({
          type: 'BACKEND_PHASE_SYNC',
          phase: backendPhase,
        });
      } catch (err) {
        console.error('[LIFECYCLE][MANUAL_REFRESH_FAILED]', err);
      }
    }

    function handleLifecycleRefresh() {
      refetchLifecycle();
    }

    /**
     * 🔗 GLOBAL LIFECYCLE INVALIDATION EVENTS
     *
     * Add more events here when needed:
     * - OAuth complete
     * - Integration connected
     */
    window.addEventListener('lifecycle:refresh', handleLifecycleRefresh);

    return () => {
      window.removeEventListener('lifecycle:refresh', handleLifecycleRefresh);
    };
  }, []);


  const isHydratedTerminal =
    state.phase === 'FT1_READY' || state.phase === 'FT2_READY';

  /**
   * FT1 Readiness Bridge (Backend Authority)
   * ----------------------------------------
   * Promotes FT1 → FT1_READY ONLY when backend signals readiness.
   */
  useEffect(() => {
    if (state.hasLatchedFT1) return;
    if (state.hasLatchedFT2) return;
    if (!state.integrationExists) return;

    let cancelled = false;

    async function checkReadiness() {
      try {
        const readiness = await getFt2Readiness();
        /**
         * 🚫 ARCHITECTURE GUARD
         * ---------------------
         * Readiness MUST NOT mutate lifecycle.
         *
         * Lifecycle is sourced exclusively from:
         *   GET /api/v1/lifecycle
         *
         * Readiness is ONLY used for:
         *   - FT2 eligibility
         *   - Progress UI
         *
         * Violating this causes:
         *   - Blank screens
         *   - Delayed FT1 rendering
         *   - Lifecycle/readiness coupling
         */
        if (readiness.ready && !cancelled) {
          console.info('[READINESS_READY_NO_LIFECYCLE_MUTATION]', {
            readiness,
          });

          // ❌ DO NOT dispatch lifecycle events here
        }
      } catch (err) {
        console.error('[FT1_READINESS_CHECK_FAILED]', err);
      }
    }

    checkReadiness();

    /**
     * Polling retained ONLY for UI-level readiness awareness.
     * Must NOT influence lifecycle state.
     */
    const interval = setInterval(checkReadiness, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    state.hasLatchedFT1,
    state.hasLatchedFT2,
    state.integrationExists,
  ]);

  useEffect(() => {
    /**
     * ⚠️ DISABLED — FRONTEND READINESS DERIVATION
     *
     * FT1 readiness must NOT be inferred from onboarding signals.
     * Backend lifecycle + readiness API must be the only authority.
     *
     * This previously caused:
     * - Premature FT1_READY
     * - FT2 button enabled before system readiness
     */
  }, []);

  /* ---------------- FT2 restore ---------------- */

  useEffect(() => {
    if (isHydratedTerminal) return;
    
    if (hasFT2Seal && integration.hasIntegration) {
      console.log('[FT2_RESTORE_FROM_LOCALSTORAGE]');

      // Allow boot + integration to resolve first
      dispatch({ type: 'BOOT_RESOLVED' });
      dispatch({ type: 'INTEGRATION_CREATED' });

      // Then force FT2
      dispatch({ type: 'FT2_BACKEND_COMPLETE' });

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

  if (!isResolved) {
    return (
      //TODO: Replace by a loader/spinner
      <div style={{ padding: 24 }}>
        <h3>Initializing workspace…</h3>
      </div>
    );
  }

  return (
    <ShopLifecycleContext.Provider value={{ phase: state.phase }}>
      {children}
    </ShopLifecycleContext.Provider>
  );
}