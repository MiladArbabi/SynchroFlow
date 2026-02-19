// apps/frontend/src/runtime/resolveNavigation.ts
import { getNavigation } from './registerNav';
import { getRegisteredModules } from './registerModule';
import { resolveNavVisibility } from '../navigation/resolveNavVisibility';
import type { EntitlementSnapshot } from './EntitlementSnapshot';
import type { UILifecyclePhase } from '../lifecycle/types';
import type { ElementType } from 'react';

export interface ResolvedNavItem {
  id: string;
  title: string;
  path: string;
  icon?: ElementType;
  disabled: boolean;
}

export interface ResolvedNavGroup {
  id: string;
  label: string;
  items: ResolvedNavItem[];
}

export interface ResolvedNavigation {
  groups: ResolvedNavGroup[];
}

interface ResolveNavigationInput {
  entitlements: EntitlementSnapshot | null;
  lifecyclePhase: UILifecyclePhase;
}

export function resolveNavigation({
  entitlements,
  lifecyclePhase
}: ResolveNavigationInput): ResolvedNavigation {

  console.log('LIFECYCLE PHASE:', lifecyclePhase);
  console.log('ENTITLEMENTS:', entitlements);

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

            // 🔐 Entitlement Visibility Gate
            const visibility = resolveNavVisibility({
            requiredModuleId: item.requiredModuleId,
            modules: entitlements ? Array.from(entitlements.modules) : []
        });

            if (visibility === 'hidden') continue;

            resolvedItems.push({
            id: item.id,
            title: item.title ?? item.id,
            path: item.path,
            icon: item.icon,
            disabled: visibility === 'locked'
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
