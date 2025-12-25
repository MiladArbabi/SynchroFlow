// apps/frontend/src/lifecycle/GenericLifecycleShell.tsx

import React from 'react';
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

interface GenericLifecycleShellProps {
  /** Identity */
  scopeId: string;

  /** Activation surface config (shop-owned) */
  activationConfig: ActivationSurfaceProps;

  /** Lifecycle inputs */
  backendPhase: 'FT_MINUS_ONE' | 'FT0' | 'FT1' | 'FT2';
  activationState:
    | 'UNKNOWN'
    | 'INACTIVE'
    | 'ACTIVE'
    | 'SYNC_IN_PROGRESS';

  /** Readiness signal */
  isReady: boolean;

  /** Monetization (optional) */
  requiresPayment?: boolean;
  hasPaidEntitlement?: boolean;

  /** Actions */
  onActivate: (actionId: string) => void;
  onDismissSync?: () => void;

  /** Final content */
  children: React.ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function GenericLifecycleShell({
  scopeId,
  backendPhase,
  activationState,
  isReady,
  requiresPayment = false,
  hasPaidEntitlement = false,
  children,
}: GenericLifecycleShellProps) {
  /**
   * 🚨 HARD ARCHITECTURAL RULE
   * GenericLifecycleShell does NOT decide lifecycle.
   * The caller MUST pass the resolved backendPhase correctly.
   */
  const phase = backendPhase;

  if (import.meta.env.DEV) {
    console.debug('[GenericLifecycleShell]', {
      scopeId,
      backendPhase,
      activationState,
      isReady,
      requiresPayment,
      hasPaidEntitlement,
      resolvedPhase: phase,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Phase → UI mapping                                                        */
  /* ------------------------------------------------------------------------ */
  switch (phase) {
    /**
     * 🔒 FT2 — MODULE-ONLY PAYWALL
     */
    case 'FT2':
      return (
        <div style={{ padding: 32 }}>
          <h2>Upgrade required</h2>
          <p>This feature requires a paid plan.</p>
        </div>
      );

    /**
     * ✅ FT1 — fully usable
     */
    case 'FT1':
      return <>{children}</>;

    /* ---------------- Exhaustiveness -------------------------------------- */
    default:
      if (import.meta.env.DEV) {
        console.error('[GenericLifecycleShell] Unhandled phase', phase);
      }
      return null;
  }
}