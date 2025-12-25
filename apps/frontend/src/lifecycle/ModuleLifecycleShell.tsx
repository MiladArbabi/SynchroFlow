// apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx

import React from 'react';
import { ActivationSurfaceProps } from '@lasyncro/shared/ui';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useShopLifecycle } from './ShopLifecycleContext';

import {
  analyticsActivationConfig,
  customersActivationConfig,
  productsActivationConfig,
  orderNexusActivationConfig,
  financesActivationConfig,
} from 'activation/configs';

import { GenericLifecycleShell } from './GenericLifecycleShell';
import { ModuleContentHost } from './ModuleContentHost';

/* -------------------------------------------------------------------------- */
/* Activation configs                                                         */
/* -------------------------------------------------------------------------- */

const ACTIVATION_CONFIGS: Record<string, ActivationSurfaceProps> = {
  analytics: analyticsActivationConfig,
  customers: customersActivationConfig,
  products: productsActivationConfig,
  'order-nexus': orderNexusActivationConfig,
  finances: financesActivationConfig,
};

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
    
  return (
    <GenericLifecycleShell
      scopeId={moduleId}
      activationConfig={ACTIVATION_CONFIGS[moduleId]}
      backendPhase={backendPhase}
      activationState="ACTIVE"
      isReady
      requiresPayment
      hasPaidEntitlement={hasPaidEntitlement}
      onActivate={() => {}}
    >
      {children}
      <ModuleContentHost
        moduleId={moduleId}
        phase={backendPhase === 'FT1' ? 'FT1_READY' : 'FT2_PAYWALL'}
        hasPaidEntitlement={hasPaidEntitlement}
      />
    </GenericLifecycleShell>
  );
}
