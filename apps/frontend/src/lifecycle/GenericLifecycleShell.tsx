/**
 * GenericLifecycleShell
 * ---------------------
 *
 * MODEL A — POST-FT1 UI LIFECYCLE SHELL
 *
 * HARD INVARIANTS:
 * - MUST ONLY mount after FT1_READY
 * - MUST NEVER receive FT_MINUS_ONE or FT0 phases
 * - Controls rendering behavior ONLY (not routing)
 *
 * RESPONSIBILITY:
 * - FT1 → render content
 * - FT2 → render paywall
 *
 * If this shell renders incorrectly:
 * → the routing architecture is broken upstream
 */

// apps/frontend/src/lifecycle/GenericLifecycleShell.tsx

import React, { useEffect, useState } from 'react';
import './lifecycleFade.css';
import { DashboardSkeletons } from 'components/skeletons/DashboardSkeletons';

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface GenericLifecycleShellProps {
  /** Identity (debugging & instrumentation only) */
  scopeId: string;

  /**
   * Lifecycle phase (MODEL A)
   * - FT1: usable
   * - FT2: paywalled
   *
   * Pre-FT1 phases are structurally impossible here.
   */
  backendPhase: 'FT1' | 'FT2';

  /** Readiness signal (FT1 only) */
  isReady: boolean;

  /** Monetization (FT2 only) */
  requiresPayment?: boolean;
  hasPaidEntitlement?: boolean;

  /** Final renderable content */
  children: React.ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function GenericLifecycleShell({
  scopeId,
  backendPhase,
  isReady,
  requiresPayment = false,
  hasPaidEntitlement = false,
  children,
}: GenericLifecycleShellProps) {

  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showContent, setShowContent] = useState(false);

 const skeletonStartTs = React.useRef<number | null>(null);
 const MIN_SKELETON_MS = 800; // perceptual minimum

  useEffect(() => {
    if (!isReady) return;

    // First FT1 render
    if (skeletonStartTs.current === null) {
      skeletonStartTs.current = performance.now();

      if (import.meta.env.DEV) {
        console.info('[Lifecycle][FT1][Skeleton] Mounted', {
          scopeId,
        });
      }
    }

    // Mount content invisibly
    setShowContent(true);

    const elapsed = performance.now() - skeletonStartTs.current;
    const remaining = Math.max(0, MIN_SKELETON_MS - elapsed);

    const timer = setTimeout(() => {
      setShowSkeleton(false);

      if (import.meta.env.DEV) {
        console.info('[Lifecycle][FT1][Skeleton→Content]', {
          scopeId,
          durationMs: performance.now() - (skeletonStartTs.current ?? 0),
        });
      }

      skeletonStartTs.current = null;
    }, remaining);

    return () => clearTimeout(timer);
  }, [isReady, scopeId]);


  if (import.meta.env.DEV) {
    console.debug('[GenericLifecycleShell]', {
      scopeId,
      backendPhase,
      isReady,
      requiresPayment,
      hasPaidEntitlement,
    });

    if (backendPhase === 'FT2' && !requiresPayment) {
      throw new Error(
        `[GenericLifecycleShell] FT2 phase requires requiresPayment=true (scope: ${scopeId})`
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Phase → UI mapping                                                        */
  /* ------------------------------------------------------------------------ */

  switch (backendPhase) {
    /**
     * 🔒 FT2 — Paywall
     */
    case 'FT2':
      if (hasPaidEntitlement) {
        return <>{children}</>;
      }

      return (
        <div style={{ padding: 32 }}>
          <h2>Upgrade required</h2>
          <p>This feature requires a paid plan.</p>
        </div>
      );

    /**
     * ✅ FT1 — Fully usable
     */
    case 'FT1':
      return (
        <div style={{ position: 'relative', minHeight: '100%' }}>
          {/* Skeleton layer */}
          <div
            className={`lifecycle-layer ${
              showSkeleton ? 'lifecycle-visible' : 'lifecycle-hidden'
            }`}
          >
            {scopeId === 'dashboard' && <DashboardSkeletons />}
          </div>

          {/* Content layer */}
          <div
            className={`lifecycle-layer ${
              showContent ? 'lifecycle-visible' : 'lifecycle-hidden'
            }`}
          >
            {children}
          </div>
        </div>
      );
  }
}
