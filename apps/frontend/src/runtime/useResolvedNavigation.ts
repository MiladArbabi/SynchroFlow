// apps/frontend/src/runtime/useResolvedNavigation.ts
import { useMemo } from 'react';
import { useEntitlements } from '../contexts/EntitlementsContext';
import { useShopLifecycle } from '../lifecycle/ShopLifecycleContext';
import { resolveNavigation } from './resolveNavigation';
import { getRegisteredModules } from './registerModule';
import { useRegisteredModules } from './useRegisteredModules';

export function useResolvedNavigation() {
  const { snapshot } = useEntitlements(); // ✅ canononal only
  const { phase } = useShopLifecycle();
  const registeredModules = useRegisteredModules();

  console.log('RESOLVED INSIDE HOOK:', resolveNavigation({
    entitlements: snapshot,
    lifecyclePhase: phase
  }));

  console.log('MODULES INSIDE HOOK:', getRegisteredModules());

  return useMemo(() => {
    // intentionally reference to bind reactivity
    void registeredModules;

    return resolveNavigation({
      entitlements: snapshot,
      lifecyclePhase: phase
    });
  }, [snapshot, phase, registeredModules]);
}
