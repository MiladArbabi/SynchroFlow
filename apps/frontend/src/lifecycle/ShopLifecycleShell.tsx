/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/lifecycle/ShopLifecycleShell.tsx
//
// ShopLifecycleShell
// ==================
//
// SINGLE SOURCE OF TRUTH for shop lifecycle phase resolution.
//
// Converts the following *structural signals*:
//
//   - integration existence (Model A)
//   - backend sync status
//   - onboarding readiness
//   - persisted FT1 seal
//
// into a STABLE, MONOTONIC, NON-REGRESSING visual lifecycle phase.
//
// -----------------------------------------------------------------------------
// HARD INVARIANTS (NON-NEGOTIABLE)
//
// 1. FT1 is only valid while an integration EXISTS
// 2. If integration is removed → lifecycle MUST reset to FT_MINUS_ONE
// 3. Once FT1 is reached during a valid integration → no regression
// 4. Auth churn / refresh / backend races MUST NOT cause flicker
// 5. Hooks MUST always execute in a stable order
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from 'contexts/AuthContext';
import { useIntegration } from 'contexts/integration';
import { ShopLifecycleContext } from './ShopLifecycleContext';
import { useOnboardingReadiness } from './useOnboardingReadiness';
import { ShopLifecyclePhase } from './types';

/* -------------------------------------------------------------------------- */
/* Phase ordering (used to prevent regressions)                                */
/* -------------------------------------------------------------------------- */

const PHASE_RANK: Record<ShopLifecyclePhase, number> = {
  FT_MINUS_ONE: 0,
  FT0_SYNCING: 1,
  FT0_PREPARING: 2,
  FT1_READY: 3,
};

const isFt0 = (p: ShopLifecyclePhase) =>
  p === 'FT0_SYNCING' || p === 'FT0_PREPARING';

/**
 * Minimum time FT0 must be visually shown
 * (prevents jarring FT0 → FT1 jumps)
 */
const VISUAL_FT0_MIN_MS = 2500;

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function ShopLifecycleShell({
  children,
}: {
  children: React.ReactNode;
}) {
  /* ------------------------------------------------------------------------ */
  /* External signals (Model A only)                                           */
  /* ------------------------------------------------------------------------ */

  const { bootResolved, existence, syncStatus } = useIntegration();
  const { user } = useAuth();

  const shopId = user?.shop_id ?? null;

  /* ------------------------------------------------------------------------ */
  /* Derived integration facts                                                 */
  /* ------------------------------------------------------------------------ */

  const integrationExists = existence === 'EXISTS';
  const isBooting = !bootResolved;
  const syncCompleted = syncStatus === 'COMPLETED';

  /* ------------------------------------------------------------------------ */
  /* FT1 Seal (persisted, per-shop, reversible if integration removed)         */
  /* ------------------------------------------------------------------------ */

  const ft1SealKey = shopId ? `shop:${shopId}:ft1-seen` : null;

  const ft1Sealed = React.useMemo(() => {
    if (!ft1SealKey) return false;
    try {
      return localStorage.getItem(ft1SealKey) === 'true';
    } catch {
      return false;
    }
  }, [ft1SealKey]);

  /* ------------------------------------------------------------------------ */
  /* Backend readiness                                                         */
  /* ------------------------------------------------------------------------ */

  const { data: readiness } = useOnboardingReadiness(
    syncCompleted,
    shopId
  );

  const backendAllowsFT1 =
    syncCompleted || readiness?.ft1?.isComplete === true;

  /* ------------------------------------------------------------------------ */
  /* Persist FT1 seal ONLY when backend explicitly confirms readiness           */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      ft1SealKey &&
      !ft1Sealed &&
      readiness?.ft1?.isComplete === true
    ) {
      localStorage.setItem(ft1SealKey, 'true');

      if (import.meta.env.DEV) {
        console.info('[ShopLifecycle] FT1 seal persisted');
      }
    }
  }, [ft1SealKey, ft1Sealed, readiness?.ft1?.isComplete]);

  /* ------------------------------------------------------------------------ */
  /* Logical phase (pure, backend-derived)                                     */
  /* ------------------------------------------------------------------------ */

  let resolvedPhase: ShopLifecyclePhase;

  // 🔒 Absolute boot gate — nothing is meaningful before boot resolves
  if (!bootResolved || !shopId) {
    resolvedPhase = 'FT_MINUS_ONE';
  } else if (!integrationExists) {
    resolvedPhase = 'FT_MINUS_ONE';
  } else if (syncStatus !== 'COMPLETED') {
    resolvedPhase = 'FT0_SYNCING';
  } else if (readiness?.ft1?.isComplete === true) {
    resolvedPhase = 'FT1_READY';
  } else {
    resolvedPhase = 'FT0_PREPARING';
  }

  /* ------------------------------------------------------------------------ */
  /* Visual latch (anti-flicker state machine)                                 */
  /* ------------------------------------------------------------------------ */

  const [latchedPhase, setLatchedPhase] =
    useState<ShopLifecyclePhase | null>(null);

  const ft0EnteredAtRef = useRef<number | null>(null);
  const hasEverReachedFT1Ref = useRef<boolean>(false);

  useEffect(() => {
    
    /**
     * 🚨 HARD RESET (authoritative deletion only)
     */
    if (!integrationExists && bootResolved) {
      hasEverReachedFT1Ref.current = false;
      ft0EnteredAtRef.current = null;

      if (ft1SealKey) {
        localStorage.removeItem(ft1SealKey);
      }

      setLatchedPhase('FT_MINUS_ONE');
      return;
    }

    /**
     * 🔒 ABSORBING FT1
     * Valid only while integration exists
     */
    if (hasEverReachedFT1Ref.current || ft1Sealed) {
      // Absorbing FT1 — valid ONLY while integration exists
      if (integrationExists) {
        hasEverReachedFT1Ref.current = true;
        setLatchedPhase('FT1_READY');
      }
      return;
    }

    /**
     * First-ever latch
     */
    if (latchedPhase == null) {
      if (resolvedPhase === 'FT1_READY') {
        // Backend jumped ahead → synthesize FT0 first
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

    /**
     * Sync just completed → force FT0_PREPARING once
     */
    if (
      latchedPhase === 'FT0_SYNCING' &&
      resolvedPhase === 'FT1_READY'
    ) {
      ft0EnteredAtRef.current = performance.now();
      setLatchedPhase('FT0_PREPARING');
      return;
    }

    /**
     * Prevent regression
     */
    if (PHASE_RANK[resolvedPhase] < PHASE_RANK[latchedPhase]) {
      return;
    }

    /**
     * FT0 entry / update
     * Sync completion MUST transition through FT0_PREPARING
     */
    if (resolvedPhase === 'FT0_SYNCING') {
      if (ft0EnteredAtRef.current == null) {
        ft0EnteredAtRef.current = performance.now();
      }
      setLatchedPhase('FT0_SYNCING');
      return;
    }

    if (resolvedPhase === 'FT0_PREPARING') {
      if (ft0EnteredAtRef.current == null) {
        ft0EnteredAtRef.current = performance.now();
      }
      setLatchedPhase('FT0_PREPARING');
      return;
    }

    /**
     * FT1 promotion with enforced dwell
     */
    if (resolvedPhase === 'FT1_READY') {
      if (ft0EnteredAtRef.current == null) {
        ft0EnteredAtRef.current = performance.now();
        setLatchedPhase('FT0_PREPARING');
        return;
      }

      const elapsed =
        performance.now() - ft0EnteredAtRef.current;

      if (
        elapsed >= VISUAL_FT0_MIN_MS &&
        readiness?.ft1?.isComplete === true
      ) {
        hasEverReachedFT1Ref.current = true;
        setLatchedPhase('FT1_READY');
        return;
      }

      const timer = setTimeout(() => {
        setLatchedPhase('FT1_READY');
      }, Math.max(0, VISUAL_FT0_MIN_MS - elapsed));

      return () => clearTimeout(timer);
    }
  }, [integrationExists, ft1Sealed, resolvedPhase, latchedPhase, readiness?.ft1?.isComplete, ft1SealKey, bootResolved]);

  /* ------------------------------------------------------------------------ */
  /* Instrumentation                                                           */
  /* ------------------------------------------------------------------------ */

  if (import.meta.env.DEV) {
    console.info('[ShopLifecycle]', {
      shopId,
      integrationExists,
      syncStatus,
      ft1Sealed,
      readiness: readiness?.ft1,
      resolvedPhase,
      latchedPhase,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Final visual phase                                                        */
  /* ------------------------------------------------------------------------ */

  const visualPhase: ShopLifecyclePhase =
    latchedPhase ?? resolvedPhase;

  return (
    <ShopLifecycleContext.Provider value={{ phase: visualPhase }}>
      {children}
    </ShopLifecycleContext.Provider>
  );
}
