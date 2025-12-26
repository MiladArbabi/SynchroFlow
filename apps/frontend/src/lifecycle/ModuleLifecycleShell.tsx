// apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx

import React from 'react';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useShopLifecycle } from './ShopLifecycleContext';
import { ModuleContentHost } from './ModuleContentHost';

interface ModuleLifecycleShellProps {
  moduleId: string;
  children: React.ReactNode;
}

export function ModuleLifecycleShell({
  moduleId,
  children,
}: ModuleLifecycleShellProps) {
  const { modules: paidModules } = useEntitlements();
  const { phase: shopPhase } = useShopLifecycle();

  if (import.meta.env.DEV && shopPhase !== 'FT1_READY') {
    throw new Error(
      `[ModuleLifecycleShell] Module "${moduleId}" mounted before FT1_READY.`
    );
  }

  const hasPaidEntitlement = paidModules.includes(moduleId);

  return (
    <>
      {children}

      <ModuleContentHost
        moduleId={moduleId}
        phase={hasPaidEntitlement ? 'FT1_READY' : 'FT2_PAYWALL'}
        hasPaidEntitlement={hasPaidEntitlement}
      />
    </>
  );
}
