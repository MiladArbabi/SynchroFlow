// apps/frontend/src/lifecycle/ShopLifecycleShell.tsx

import React, { useEffect, useRef, useState } from 'react';
import { useIntegrationSyncStatus } from 'contexts/IntegrationContext';
import { ShopLifecycleContext } from './ShopLifecycleContext';
import { useOnboardingReadiness } from './useOnboardingReadiness';
import { ShopLifecyclePhase } from './types';
import { useAuth } from 'contexts/AuthContext';

const PHASE_RANK: Record<ShopLifecyclePhase, number> = {
  FT_MINUS_ONE: 0,
  FT0_SYNCING: 1,
  FT0_PREPARING: 2,
  FT1_READY: 3,
};

const isFt0 = (p: ShopLifecyclePhase) =>
  p === 'FT0_SYNCING' || p === 'FT0_PREPARING';

const VISUAL_FT0_MIN_MS = 2500;

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

    const ft0EnteredAtRef = useRef<number | null>(null);

    useEffect(() => {
      // FIRST EVER LATCH
      if (latchedPhase == null) {
        if (resolvedPhase === 'FT1_READY') {
          // Backend jumped ahead → synthesize FT0
          ft0EnteredAtRef.current = performance.now();
          setLatchedPhase('FT0_PREPARING');
          return;
        }

        if (isFt0(resolvedPhase)) {
          ft0EnteredAtRef.current = performance.now();
        }

        setLatchedPhase(resolvedPhase);
        return;
      }

      // NEVER REGRESS
      if (PHASE_RANK[resolvedPhase] < PHASE_RANK[latchedPhase]) {
        return;
      }

      // FT0 ENTRY (natural)
      if (isFt0(resolvedPhase)) {
        if (ft0EnteredAtRef.current == null) {
          ft0EnteredAtRef.current = performance.now();
        }
        setLatchedPhase(resolvedPhase);
        return;
      }

      // FT1 PROMOTION WITH HARD DWELL
      if (resolvedPhase === 'FT1_READY') {
        // FT0 never latched → force it now
        if (ft0EnteredAtRef.current == null) {
          ft0EnteredAtRef.current = performance.now();
          setLatchedPhase('FT0_PREPARING');
          return;
        }

        const elapsed = performance.now() - ft0EnteredAtRef.current;

        if (elapsed >= VISUAL_FT0_MIN_MS) {
          setLatchedPhase('FT1_READY');
          return;
        }

        // HOLD FT0 EXPLICITLY
        setLatchedPhase(
          isFt0(latchedPhase) ? latchedPhase : 'FT0_PREPARING'
        );

        const timer = setTimeout(() => {
          setLatchedPhase('FT1_READY');
        }, VISUAL_FT0_MIN_MS - elapsed);

        return () => clearTimeout(timer);
      }
    }, [resolvedPhase, latchedPhase]);


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
