/* eslint-disable react-hooks/exhaustive-deps */
// apps/frontend/src/lifecycle/VisualLifecycleLatch.tsx

import React from 'react';
import { UILifecyclePhase } from './types';

import { useIntegration } from 'contexts/integration';
import { useAuth } from 'contexts/AuthContext';
import { useOnboardingReadiness } from './useOnboardingReadiness';

const VISUAL_FT0_MIN_MS = 2500;

/**
 * VisualLifecycleLatch
 * ====================
 * Deterministic visual state machine.
 *
 * HARD INVARIANTS (ENFORCED BY ORDER):
 * 1. bootResolved gates ALL meaning
 * 2. integration deletion is a hard reset
 * 3. FT1 is absorbing ONLY while integration exists
 * 4. FT0 is always shown at least once
 * 5. FT0 minimum dwell is enforced exactly once
 *
 * Any violation is logged.
 */
export function VisualLifecycleLatch({
  children,
}: {
  children: (phase: UILifecyclePhase) => React.ReactNode;
}) {
  /* ------------------------------------------------------------------ */
  /* External inputs                                                     */
  /* ------------------------------------------------------------------ */

  const integration = useIntegration();
  const { user } = useAuth();

  const shopId = user?.shop_id ?? null;
  const bootResolved = integration.bootResolved;
  const integrationExists = integration.existence === 'EXISTS';
  const syncStatus = integration.syncStatus;

  const { data } = useOnboardingReadiness(
    bootResolved && integration.hasIntegration,
    shopId ?? undefined
  );

  const ft1BackendComplete = !!data?.ft1?.isComplete;

  /* ------------------------------------------------------------------ */
  /* Internal latch state (authoritative)                                */
  /* ------------------------------------------------------------------ */

  const [phase, setPhase] = React.useState<UILifecyclePhase>('FT_MINUS_ONE');

  const ft0EnteredAt = React.useRef<number | null>(null);
  const ft0TimerRef = React.useRef<number | null>(null);
  const hasEverReachedFT1 = React.useRef(false);
  const prevIntegrationExists = React.useRef<boolean | null>(null);
  const hasSeenCompleted = React.useRef(false);

  /* ------------------------------------------------------------------ */
  /* FT1 seal (persistent restore)                                       */
  /* ------------------------------------------------------------------ */

  const ft1SealKey =
    shopId != null ? `shop:${shopId}:ft1-seen` : null;

  const hasFt1Seal = React.useMemo(() => {
    if (!ft1SealKey) return false;

    const value = localStorage.getItem(ft1SealKey);

    if (!integrationExists && value === 'true') {
      console.log('[VLL][SEAL] invalidated (no integration)');
      localStorage.removeItem(ft1SealKey);
      return false;
    }

    return value === 'true';
  }, [ft1SealKey, integrationExists]);

  /* ------------------------------------------------------------------ */
  /* Phase logger (single source of truth)                               */
  /* ------------------------------------------------------------------ */

  React.useEffect(() => {
    console.log('[VLL][PHASE]', {
      phase,
      bootResolved,
      integrationExists,
      syncStatus,
      hasEverReachedFT1: hasEverReachedFT1.current,
      hasFt1Seal,
      ft0EnteredAt: ft0EnteredAt.current,
    });
  }, [phase]);

  /* ------------------------------------------------------------------ */
  /* HARD RESET: integration deletion                                   */
  /* ------------------------------------------------------------------ */

  React.useEffect(() => {
    if (
      prevIntegrationExists.current === true &&
      integrationExists === false
    ) {
      console.log('[VLL][RESET] integration deleted');

      if (ft1SealKey) {
        localStorage.removeItem(ft1SealKey);
      }

      hasEverReachedFT1.current = false;
      ft0EnteredAt.current = null;

      if (ft0TimerRef.current) {
        clearTimeout(ft0TimerRef.current);
        ft0TimerRef.current = null;
      }

      setPhase('FT_MINUS_ONE');
    }

    prevIntegrationExists.current = integrationExists;
  }, [integrationExists, ft1SealKey]);

  /* ------------------------------------------------------------------ */
  /* MAIN STATE MACHINE                                                  */
  /* ------------------------------------------------------------------ */

  React.useEffect(() => {
    console.log('[VLL][EFFECT]', {
      bootResolved,
      integrationExists,
      syncStatus,
      hasEverReachedFT1: hasEverReachedFT1.current,
      hasFt1Seal,
    });

    /* -------------------------------------------------------------- */
    /* integration existence is a hard guard                       */
    /* -------------------------------------------------------------- */

    // 🔒 ABSOLUTE HARD STOP — nothing survives integration deletion
    if (!integrationExists) {
    console.log('[VLL][SET] FT_MINUS_ONE (no integration)');
    setPhase('FT_MINUS_ONE');
    return;
    }

    /* -------------------------------------------------------------- */
    /* 1. bootResolved gates everything                               */
    /* -------------------------------------------------------------- */

    if (!bootResolved) {
      console.log('[VLL][SET] FT_MINUS_ONE (boot not resolved)');
      setPhase('FT_MINUS_ONE');
      return;
    }

    /* -------------------------------------------------------------- */
    /* 3. FT1 absorption (ONLY if integration exists)                 */
    /* -------------------------------------------------------------- */

    // Absorbing FT1 — ONLY while integration EXISTS
    if (integrationExists && (hasEverReachedFT1.current || hasFt1Seal)) {
    console.log('[VLL][SET] FT1_READY (absorbing)');
    hasEverReachedFT1.current = true;
    setPhase('FT1_READY');
    return;
    }

    /* -------------------------------------------------------------- */
    /* 4. COMPLETED always enters FT0_PREPARING once                  */
    /* -------------------------------------------------------------- */

    if (syncStatus === 'COMPLETED') {
    // 🔒 COMPLETED is a terminal edge for FT0_SYNCING
    hasSeenCompleted.current = true;

    if (!ft0EnteredAt.current) {
        ft0EnteredAt.current = performance.now();
        console.log('[VLL][SET] FT0_PREPARING (enter)');
    } else {
        console.log('[VLL][STAY] FT0_PREPARING');
    }

    setPhase('FT0_PREPARING');

    if (!ft0TimerRef.current) {
        ft0TimerRef.current = window.setTimeout(() => {
        console.log('[VLL][TIMER] FT0 dwell elapsed');

        if (ft1BackendComplete && integrationExists) {
            console.log('[VLL][SET] FT1_READY (promotion)');
            hasEverReachedFT1.current = true;

            if (ft1SealKey) {
            localStorage.setItem(ft1SealKey, 'true');
            }

            setPhase('FT1_READY');
        }
        }, VISUAL_FT0_MIN_MS);
    }

    return;
    }

    /* -------------------------------------------------------------- */
    /* 5. SYNCING / PENDING before COMPLETED                          */
    /* -------------------------------------------------------------- */

    // SYNCING / PENDING is ONLY allowed BEFORE COMPLETED is seen
    if (
        (syncStatus === 'SYNCING' || syncStatus === 'PENDING') &&
        !hasSeenCompleted.current
    ) {
        console.log('[VLL][SET] FT0_SYNCING');
        setPhase('FT0_SYNCING');
        return;
    }

  }, [
    bootResolved,
    integrationExists,
    syncStatus,
    ft1BackendComplete,
    hasFt1Seal,
    ft1SealKey,
  ]);

  /* ------------------------------------------------------------------ */

  return <>{children(phase)}</>;
}
