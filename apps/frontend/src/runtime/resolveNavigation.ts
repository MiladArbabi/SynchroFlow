// apps/frontend/src/runtime/resolveNavigation.ts
import { getNavigation } from './registerNav';
import { getRegisteredModules } from './registerModule';
import { resolveNavVisibility } from '../navigation/resolveNavVisibility';
import { buildCommercialContext } from './commercialContext';
import type { UILifecyclePhase } from '../lifecycle/types';
import type { ElementType } from 'react';
import { isValidTier } from '@lasyncro/commercial-policy';
import type { AccessDecision, Tier } from '@lasyncro/commercial-policy';
import { decideCapability } from './commercialContext';

export interface ResolvedNavItem {
  id: string;
  title: string;
  path: string;
  icon?: ElementType;
  disabled: boolean;
  requiredTier?: string;
  /** Canonical AccessDecision for capabilityId-migrated items (P0-A2B) — authoritative when present. */
  decision?: AccessDecision;
  /** Submodule children — tier gating resolved per child (ISS-069/082). */
  children?: { id: string; title: string; path: string; requiredTier?: string; decision?: AccessDecision; disabled: boolean }[];
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
   * operator: the Warehouse item with its operator-eligible children only
   * (OPERATOR_WAREHOUSE_CHILD_IDS). owner/admin: full nav.
   * Latent correctness only — AppLayout never renders the sidenav for
   * operators (GH-1222). Backend requireAction remains the authority.
   */
  userRole?: string;
  /**
   * Current subscription tier for nav tier gating (MON-06).
   * Defaults to 'starter' if not provided.
   */
  currentTier?: string;
  /**
   * GH-1209: whether authoritative commercial truth is available
   * (useCommercialAccess().isResolved). When false, items stay structurally
   * visible (lifecycle/role gates still apply) but carry no commercial lock
   * or AccessDecision — unknown is never presented as DENY. Defaults to true.
   */
  commercialResolved?: boolean;
}

// GH-1222: the canonical top-level Warehouse nav id (navBootstrap), and the
// Warehouse children an operator is role-eligible for. Floor Planning and
// Analytics are owner/admin management surfaces.
const WAREHOUSE_NAV_ID = 'warehouse';
const OPERATOR_WAREHOUSE_CHILD_IDS: ReadonlySet<string> = new Set(['wms-operations', 'product-issues']);

export function resolveNavigation({
  entitlements,
  lifecyclePhase,
  userRole,
  currentTier = 'starter',
  commercialResolved = true,
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

  // COMMERCIAL-ACCESS-ARCH-01 P0-A2B: single AccessContext for every
  // capabilityId-migrated nav item — never a per-item hand-rolled evaluation.
  const resolvedTier: Tier = isValidTier(currentTier) ? currentTier : 'starter';
  const commercialContext = buildCommercialContext({
    tier: resolvedTier,
    snapshot: {
      modules: entitlements ? entitlements.modules : new Set<string>(),
      flags: entitlements ? entitlements.flags : new Set<string>(),
    },
  });

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

        // 🔒 Role gate (before any commercial evaluation): operators only see
        // the Warehouse item. Its role-ineligible children are removed below,
        // before their commercial decision is computed.
        const isOperator = userRole === 'operator';
        if (isOperator && item.id !== WAREHOUSE_NAV_ID) continue;

            // 🔐 Entitlement + Tier Visibility Gate (MON-06)
            const itemDecision = commercialResolved && item.capabilityId
              ? decideCapability(item.capabilityId, commercialContext)
              : undefined;
            const visibility = !commercialResolved ? 'enabled' : resolveNavVisibility({
              requiredModuleId: item.requiredModuleId,
              modules: entitlements ? Array.from(entitlements.modules) : [],
              requiredTier: item.requiredTier,
              currentTier,
              capabilityId: item.capabilityId,
              context: item.capabilityId ? commercialContext : undefined,
            });

            if (visibility === 'hidden') continue;

            // ISS-069/082: tier gating was previously only computed for the
            // parent item — children silently passed through ungated, which
            // let the sidebar navigate straight into tier-locked pages that
            // ModuleTabBar correctly blocks. Resolve each child's visibility
            // the same way the parent is resolved above.
            const resolvedChildren = (item.children ?? [])
              .filter((child) => !isOperator || OPERATOR_WAREHOUSE_CHILD_IDS.has(child.id))
              .map((child) => {
                const childDecision = commercialResolved && child.capabilityId
                  ? decideCapability(child.capabilityId, commercialContext)
                  : undefined;
                const childVisibility = !commercialResolved ? 'enabled' : resolveNavVisibility({
                  requiredModuleId: item.requiredModuleId,
                  modules: entitlements ? Array.from(entitlements.modules) : [],
                  requiredTier: child.requiredTier,
                  currentTier,
                  capabilityId: child.capabilityId,
                  context: child.capabilityId ? commercialContext : undefined,
                });
                return { ...child, visibility: childVisibility, decision: childDecision };
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
            decision: itemDecision,
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
