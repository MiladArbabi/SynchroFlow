// apps/frontend/src/runtime/resolveNavigation.ts
import { getNavigation } from './registerNav';
import { getRegisteredModules } from './registerModule';
import { resolveNavVisibility } from '../navigation/resolveNavVisibility';
import type { UILifecyclePhase } from '../lifecycle/types';
import type { ElementType } from 'react';

export interface ResolvedNavItem {
  id: string;
  title: string;
  path: string;
  icon?: ElementType;
  disabled: boolean;
  requiredTier?: string;
  /** Submodule children — tier gating resolved per child (ISS-069/082). */
  children?: { id: string; title: string; path: string; requiredTier?: string; disabled: boolean }[];
}

export interface ResolvedNavGroup {
  id: string;
  label: string;
  items: ResolvedNavItem[];
}

export interface ResolvedNavigation {
  groups: ResolvedNavGroup[];
}

// Local snapshot contract — mirrors EntitlementsContext snapshot shape
interface EntitlementSnapshot {
  modules: Set<string>;
  flags: Set<string>;
}

interface ResolveNavigationInput {
  entitlements: EntitlementSnapshot | null;
  lifecyclePhase: UILifecyclePhase;
  /**
   * Current user role — used to restrict nav to role-permitted items.
   * operator: WMS only. owner/admin: full nav.
   * Will be superseded by action-level entitlements in WM-19.
   */
  userRole?: string;
  /**
   * Current subscription tier for nav tier gating (MON-06).
   * Defaults to 'starter' if not provided.
   */
  currentTier?: string;
}

export function resolveNavigation({
  entitlements,
  lifecyclePhase,
  userRole,
  currentTier = 'starter',
}: ResolveNavigationInput): ResolvedNavigation {

  // Debug: re-enable locally if nav resolution needs tracing. Never log in production.

  const registeredModules = getRegisteredModules();
  const moduleTierMap = new Map<string, string>();

  for (const mod of registeredModules) {
    moduleTierMap.set(
      mod.id,
      mod.lifecycleTier ?? 'FT1_CORE'
    );
  }

  const rawGroups = getNavigation();

    const groups: ResolvedNavGroup[] = [];

    for (const group of rawGroups) {
    const resolvedItems: ResolvedNavItem[] = [];

    for (const item of group.items ?? []) {

        const requiredModuleId = item.requiredModuleId;
        const moduleTier = requiredModuleId
        ? moduleTierMap.get(requiredModuleId) ?? 'FT1_CORE'
        : 'FT1_CORE';

        // 🔒 Lifecycle Phase Gate
        const lifecycleAllowed =
        lifecyclePhase === 'FT2_READY'
            ? true
            : lifecyclePhase === 'FT1_READY'
            ? moduleTier === 'FT1_CORE'
            : false;

        if (!lifecycleAllowed) continue;

        // 🔒 Role gate: operators only see WMS
        if (userRole === 'operator' && item.id !== 'wms') continue;

            // 🔐 Entitlement + Tier Visibility Gate (MON-06)
            const visibility = resolveNavVisibility({
              requiredModuleId: item.requiredModuleId,
              modules: entitlements ? Array.from(entitlements.modules) : [],
              requiredTier: item.requiredTier,
              currentTier,
            });

            if (visibility === 'hidden') continue;

            // ISS-069/082: tier gating was previously only computed for the
            // parent item — children silently passed through ungated, which
            // let the sidebar navigate straight into tier-locked pages that
            // ModuleTabBar correctly blocks. Resolve each child's visibility
            // the same way the parent is resolved above.
            const resolvedChildren = (item.children ?? [])
              .map((child) => {
                const childVisibility = resolveNavVisibility({
                  requiredModuleId: item.requiredModuleId,
                  modules: entitlements ? Array.from(entitlements.modules) : [],
                  requiredTier: child.requiredTier,
                  currentTier,
                });
                return { ...child, visibility: childVisibility };
              })
              .filter((child) => child.visibility !== 'hidden')
              .map(({ visibility, ...child }) => ({
                ...child,
                disabled: visibility === 'locked',
              }));

            resolvedItems.push({
            id: item.id,
            title: item.title ?? item.id,
            path: item.path,
            icon: item.icon,
            disabled: visibility === 'locked',
            requiredTier: item.requiredTier,
            children: resolvedChildren,
        });
    }

    if (resolvedItems.length > 0) {
        groups.push({
        id: group.id,
        label: group.label,
        items: resolvedItems
        });
    }
    };

  return { groups };
}
