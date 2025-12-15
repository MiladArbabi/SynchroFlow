// tests/ui/runtime/module-nav.integration.test.ts
import { bootstrapNavGroups } from 'runtime/navBootstrap';
import { getNavigation, _resetNav } from 'runtime/registerNav';
import { loadAllModules } from 'runtime/moduleLoader';

describe('Module-driven navigation (baseline)', () => {
  beforeEach(() => {
    _resetNav();
    bootstrapNavGroups();
  });

  it('only Order-Nexus contributes nav items via module system', async () => {
    await loadAllModules();

    const nav = getNavigation();
    const allPaths = nav.flatMap(g => g.items ?? []).map(i => i.path);

    expect(allPaths).toContain('/orders');

    // legacy pages — not yet modules
    expect(allPaths).not.toContain('/customers');
    expect(allPaths).not.toContain('/products');
    expect(allPaths).not.toContain('/analytics');
  });
});
