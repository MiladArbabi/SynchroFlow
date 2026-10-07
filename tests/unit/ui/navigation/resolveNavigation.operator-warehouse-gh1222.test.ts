// tests/unit/ui/navigation/resolveNavigation.operator-warehouse-gh1222.test.ts
//
// GH-1222 / TIER-07 — RED — stale operator nav-id assumption.
//
// resolveNavigation's operator role gate keeps only an item whose id is the
// historical `wms`, but the canonical top-level Warehouse nav identity is
// `warehouse` (navBootstrap). The stale check therefore resolves ZERO Warehouse
// identity for an operator. Ratified: correct or remove the stale assumption.
//
// This contract is about resolver OUTPUT only. It does NOT authorise rendering
// SidenavContent for operators — the AppLayout no-sidenav contract is separate
// (AppLayout.role-shell.test.tsx) and stays green.

import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { bootstrapNavGroups } from '../../../../apps/frontend/src/runtime/navBootstrap';
import { _resetNav, getNavigation } from '../../../../apps/frontend/src/runtime/registerNav';
import { resolveNavigation } from '../../../../apps/frontend/src/runtime/resolveNavigation';

const GROWTH_ENTITLEMENTS = {
  modules: new Set<string>(modulesForTier('growth')),
  flags: new Set<string>(flagsForTier('growth')),
};

function resolvedItemIds(userRole: string): string[] {
  const { groups } = resolveNavigation({
    entitlements: GROWTH_ENTITLEMENTS,
    lifecyclePhase: 'FT2_READY',
    userRole,
    currentTier: 'growth',
  });
  return groups.flatMap((g) => g.items.map((i) => i.id));
}

beforeEach(() => {
  _resetNav();
  bootstrapNavGroups();
});

describe('GH-1222 H — canonical Warehouse nav identity', () => {
  it('H1 GREEN CONTROL: the registered top-level Warehouse nav id is `warehouse`, and no `wms` item exists', () => {
    const ids = getNavigation().flatMap((g) => (g.items ?? []).map((i) => i.id));
    expect(ids).toContain('warehouse');
    expect(ids).not.toContain('wms');
  });

  it('H2 GREEN CONTROL: owner resolves the Warehouse item', () => {
    expect(resolvedItemIds('owner')).toContain('warehouse');
  });

  it('H2 EXPECTED RED: operator resolution is not emptied by the stale `wms` check — Warehouse identity resolves', () => {
    expect(resolvedItemIds('operator')).toContain('warehouse');
  });
});
