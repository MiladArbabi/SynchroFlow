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

  const shopId = user?.shop_id ?? null;

  console.debug('[LIFECYCLE_READINESS_INPUT]', {
    bootResolved: integration.bootResolved,
    hasIntegration: integration.hasIntegration,
    shopId,
  });

  const { data } = useOnboardingReadiness(
    integration.bootResolved && integration.hasIntegration,
    shopId ?? undefined
  );

  console.debug('[LIFECYCLE_READINESS_OUTPUT]', data);

  /* ---------------- Integration → lifecycle events ---------------- */

  useEffect(() => {
    if (integration.bootResolved) {
      dispatch({ type: 'BOOT_RESOLVED' });
    }
  }, [integration.bootResolved]);

  useEffect(() => {
    if (integration.existence === 'EXISTS') {
      dispatch({ type: 'INTEGRATION_CREATED' });
    } else {
      dispatch({ type: 'INTEGRATION_DELETED' });
    }
  }, [integration.existence]);

  useEffect(() => {
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
    if (data?.ft1?.isComplete) {
      dispatch({ type: 'FT1_BACKEND_COMPLETE' });
    }
  }, [data?.ft1?.isComplete]);

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