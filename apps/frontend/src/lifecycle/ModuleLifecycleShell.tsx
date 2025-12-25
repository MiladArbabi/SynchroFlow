// apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx

import React from 'react';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useShopLifecycle } from './ShopLifecycleContext';

import { GenericLifecycleShell } from './GenericLifecycleShell';
import { ModuleContentHost } from './ModuleContentHost';

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface ModuleLifecycleShellProps {
  moduleId: string;
  children: React.ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function ModuleLifecycleShell({
  moduleId,
  children,
}: ModuleLifecycleShellProps) {
  const { modules: paidModules } = useEntitlements();
  const { phase: shopPhase } = useShopLifecycle();

  const hasPaidEntitlement = paidModules.includes(moduleId);

  /**
   * 🔒 HARD INVARIANT
   * Modules MUST NEVER render unless shop is FT1_READY
   */
  if (import.meta.env.DEV) {
    if (shopPhase !== 'FT1_READY') {
      throw new Error(
        `[ModuleLifecycleShell] Module "${moduleId}" rendered while shop phase is "${shopPhase}". ` +
        `Modules must inherit shop activation and only render at FT1.`
      );
    }
  }

  const backendPhase: 'FT1' | 'FT2' =
    hasPaidEntitlement ? 'FT1' : 'FT2';

  const isReady = true; // modules are considered ready immediately at FT1 for now
  const requiresPayment = backendPhase === 'FT2';

  return (
    <GenericLifecycleShell
      scopeId={moduleId}
      backendPhase={backendPhase}
      isReady={isReady}
      requiresPayment={requiresPayment}
      hasPaidEntitlement={hasPaidEntitlement}
    >
      {children}

      {/* 
        ModuleContentHost is mounted regardless of paywall state.
        GenericLifecycleShell controls visibility.
        This enables preloading and consistent instrumentation.
      */}
      <ModuleContentHost
        moduleId={moduleId}
        phase={backendPhase === 'FT1' ? 'FT1_READY' : 'FT2_PAYWALL'}
        hasPaidEntitlement={hasPaidEntitlement}
      />
    </GenericLifecycleShell>
  );
}
