// apps/frontend/src/lifecycle/ShopLifecycleShell.tsx

import React, { useEffect, useRef, useState } from 'react';
import { useIntegrationSyncStatus } from 'contexts/IntegrationContext';
import { ShopLifecycleContext } from './ShopLifecycleContext';
import { useOnboardingReadiness } from './useOnboardingReadiness';
import { ShopLifecyclePhase } from './types';
import { useAuth } from 'contexts/AuthContext';

const VISUAL_FT0_MIN_MS = 1400;

export function ShopLifecycleShell({ children }: { children: React.ReactNode }) {
  const { status, isLoading } = useIntegrationSyncStatus();
  const { user } = useAuth();

  const shopId = user?.shop_id ?? null;
  const syncCompleted = status === 'COMPLETED';

  const { data: readiness } = useOnboardingReadiness(
    syncCompleted,
    shopId
  );

  /**
   * --- Logical phase (pure, backend-driven) ---
   */
  let resolvedPhase: ShopLifecyclePhase;

  if (isLoading || !shopId) {
    resolvedPhase = 'FT_MINUS_ONE';
  } else {
    switch (status) {
      case 'NOT_FOUND':
        resolvedPhase = 'FT_MINUS_ONE';
        break;

      case 'PENDING':
      case 'SYNCING_PRODUCTS':
      case 'SYNCING_ORDERS':
      case 'SYNCING_LINE_ITEMS':
      case 'SYNCING_INVENTORY':
      case 'SYNCING_SHOP':
      case 'COMPLETING':
        resolvedPhase = 'FT0_SYNCING';
        break;

      case 'COMPLETED':
        resolvedPhase =
          readiness?.ft1?.isComplete === true
            ? 'FT1_READY'
            : 'FT0_PREPARING';
        break;

      default:
        resolvedPhase = 'FT_MINUS_ONE';
    }
  }

  /**
   * --- Visual latch state ---
   */
  const [latchedPhase, setLatchedPhase] =
    useState<ShopLifecyclePhase | null>(null);

  const ft0SeenRef = useRef(false);
  const ft1ReleasedRef = useRef(false);

  useEffect(() => {
    // If FT0 is naturally reached, allow it immediately
    if (
      resolvedPhase === 'FT0_SYNCING' ||
      resolvedPhase === 'FT0_PREPARING'
    ) {
      ft0SeenRef.current = true;
      setLatchedPhase(resolvedPhase);
      return;
    }

    // If FT1 is reached WITHOUT ever seeing FT0 → force visual FT0 once
    if (
      resolvedPhase === 'FT1_READY' &&
      !ft0SeenRef.current &&
      !ft1ReleasedRef.current
    ) {
      ft0SeenRef.current = true;
      setLatchedPhase('FT0_PREPARING');

      const timer = setTimeout(() => {
        ft1ReleasedRef.current = true;
        setLatchedPhase('FT1_READY');
      }, VISUAL_FT0_MIN_MS);

      return () => clearTimeout(timer);
    }

    // Normal progression
    setLatchedPhase(resolvedPhase);
  }, [resolvedPhase]);

  if (import.meta.env.DEV) {
    console.info('[ShopLifecycle]', {
      shopId,
      integrationStatus: status,
      readiness: readiness?.ft1,
      resolvedPhase,
      latchedPhase,
    });
  }

  return (
    <ShopLifecycleContext.Provider
      value={{ phase: latchedPhase ?? resolvedPhase }}
    >
      {children}
    </ShopLifecycleContext.Provider>
  );
}
