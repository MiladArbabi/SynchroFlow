/* eslint-disable @typescript-eslint/no-unused-vars */
import { useMemo } from 'react';
import { useEntitlements } from '../contexts/EntitlementsContext';
import { useShopLifecycle } from '../lifecycle/ShopLifecycleContext';
import { useAuth } from '../contexts/AuthContext';
import { resolveNavigation } from './resolveNavigation';
import { getRegisteredModules } from './registerModule';
import { useRegisteredModules } from './useRegisteredModules';

export function useResolvedNavigation() {
  const { snapshot } = useEntitlements();
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const registeredModules = useRegisteredModules();

  return useMemo(() => {
    void registeredModules;
    return resolveNavigation({
      entitlements: snapshot,
      lifecyclePhase: phase,
      userRole: user?.role,
    });
  }, [snapshot, phase, registeredModules, user?.role]);
}