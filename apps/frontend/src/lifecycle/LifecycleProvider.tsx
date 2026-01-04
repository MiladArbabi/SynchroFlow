/* eslint-disable react-hooks/exhaustive-deps */
// apps/frontend/src/lifecycle/LifecycleProvider.tsx
import React, { useEffect, useReducer } from 'react';
import { ShopLifecycleContext } from './ShopLifecycleContext';
import { lifecycleReducer } from './lifecycleReducer';
import {
  initialLifecycleState,
} from './lifecycleTypes';
import { UILifecyclePhase } from './types';
import { useIntegration } from 'contexts/integration';
import { useAuth } from 'contexts/AuthContext';
import { axiosInstance } from 'api/axiosConfig';
import { useOnboardingReadiness } from './useOnboardingReadiness';
import { useLifecycleEffects } from './lifecycleEffects';

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
  const [state, dispatch] = useReducer(
    lifecycleReducer,
    initialLifecycleState
  );

  const integration = useIntegration();
  const { user } = useAuth();
  const [ft2RestoreResolved, setFt2RestoreResolved] = React.useState(false);

  const shopId = user?.shop_id ?? null;

  const hasFT2Seal =
    shopId != null &&
    localStorage.getItem(`shop:${shopId}:ft2-seen`) === 'true';

  console.log('[FT2_SEAL_CHECK]', {
    shopId,
    hasFT2Seal,
    raw: shopId
      ? localStorage.getItem(`shop:${shopId}:ft2-seen`)
      : null,
  });

  const isFT2Terminal =
    state.phase === 'FT2_READY';

  console.log('[LIFECYCLE_READINESS_INPUT]', {
    bootResolved: integration.bootResolved,
    hasIntegration: integration.hasIntegration,
    shopId,
  });

  const { data } = useOnboardingReadiness(
    integration.bootResolved && integration.hasIntegration,
    shopId ?? undefined
  );

  console.log('[LIFECYCLE_READINESS_OUTPUT]', data);

  /* ---------------- Integration → lifecycle events ---------------- */

  useEffect(() => {
    if (isFT2Terminal) return;
    if (integration.bootResolved) {
      dispatch({ type: 'BOOT_RESOLVED' });
    }
  }, [integration.bootResolved]);

  useEffect(() => {
    if (isFT2Terminal) return;
    if (integration.existence === 'EXISTS') {
      dispatch({ type: 'INTEGRATION_CREATED' });
    } else {
      dispatch({ type: 'INTEGRATION_DELETED' });
    }
  }, [integration.existence]);

  useEffect(() => {
    if (!ft2RestoreResolved || isFT2Terminal) return;
    if (
      integration.syncStatus === 'PENDING' ||
      integration.syncStatus === 'SYNCING'
    ) {
      dispatch({ type: 'SYNC_STARTED' });
    }

    if (integration.syncStatus === 'COMPLETED') {
      dispatch({ type: 'SYNC_COMPLETED' });
    }
  }, [integration.syncStatus]);

  useEffect(() => {
    if (isFT2Terminal) return;
    if (data?.ft1?.isComplete) {
      dispatch({ type: 'FT1_BACKEND_COMPLETE' });
    }
  }, [data?.ft1?.isComplete]);

  /* ---------------- FT2 restore ---------------- */

  useEffect(() => {
    console.log('[FT2_RESTORE_EFFECT_ENTER]', {
      shopId,
      hasFT2Seal,
      bootResolved: integration.bootResolved,
      hasIntegration: integration.hasIntegration,
    });

    if (hasFT2Seal) {
      console.log('[FT2_RESTORE_FROM_LOCALSTORAGE]');

      // Allow boot + integration to resolve first
      dispatch({ type: 'BOOT_RESOLVED' });
      dispatch({ type: 'INTEGRATION_CREATED' });

      // Then force FT2
      dispatch({ type: 'FT2_BACKEND_COMPLETE' });

      setFt2RestoreResolved(true);
      return;
    }

    if (!state.bootResolved) return;
    if (!state.integrationExists) return;
    if (!shopId) return;

    let cancelled = false;

    async function restoreFT2() {
      try {
        console.log('[FT2_RESTORE_FROM_API]');

        const { data } = await axiosInstance.get(
          '/api/v1/lifecycle/ft2/evaluate'
        );

        if (!cancelled && data?.eligible === true) {
          dispatch({ type: 'FT2_BACKEND_COMPLETE' });
        }
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

  return (
    <ShopLifecycleContext.Provider value={{ phase: state.phase }}>
      {children}
    </ShopLifecycleContext.Provider>
  );
}