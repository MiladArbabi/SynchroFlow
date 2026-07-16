/* eslint-disable @typescript-eslint/no-unused-vars */
import { useMemo } from 'react';
import { useEntitlements } from '../contexts/EntitlementsContext';
import { useShopLifecycle } from '../lifecycle/ShopLifecycleContext';
import { useAuth } from '../contexts/AuthContext';
import { resolveNavigation } from './resolveNavigation';
import { getRegisteredModules } from './registerModule';
import { useRegisteredModules } from './useRegisteredModules';
export function useResolvedNavigation() {
  // NAV-TIER-01: currentTier was never passed to resolveNavigation,
  // silently defaulting to 'starter' for every shop regardless of real
  // subscription. Every tier-gated nav item (Demand, Floor Planning,
  // Supplier Ratings, Returns) was locked in the sidebar for all users,
  // including paying Core/Growth/Scale customers, who saw an upgrade
  // prompt for features they already owned whenever they clicked a nav
  // item directly (page-level PlanGate checks were unaffected — this
  // only broke the sidebar's own pre-navigation gate).
  const { snapshot, tier } = useEntitlements();
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const registeredModules = useRegisteredModules();
  return useMemo(() => {
    void registeredModules;
    return resolveNavigation({
      entitlements: snapshot,
      currentTier: tier,
      lifecyclePhase: phase,
      userRole: user?.role,
    });
  }, [snapshot, tier, phase, registeredModules, user?.role]);
}