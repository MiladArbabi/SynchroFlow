// tests/unit/api/runtime/moduleRegistry.test.ts
import {
  registerModule,
  unregisterModule,
  getRegisteredModules,
  registerNavItem,
  unregisterNavItem,
  getNavItems,
  __clearAllForTests
} from 'runtime/registerModule';

describe('module registry (runtime) - minimal', () => {
  beforeEach(() => {
    __clearAllForTests();
  });

  test('registerModule and unregisterModule', () => {
    const mod = { id: 'mod-a', displayName: 'Mod A' };
    registerModule(mod as any);
    const mods = getRegisteredModules();
    expect(mods.find((m: { id: string; }) => m.id === 'mod-a')).toBeDefined();

    unregisterModule('mod-a');
    const after = getRegisteredModules();
    expect(after.find((m: { id: string; }) => m.id === 'mod-a')).toBeUndefined();
  });

  test('nav items register/unregister and ordering', () => {
    registerNavItem({ id: 'n1', title: 'First', order: 100 } as any);
    registerNavItem({ id: 'n2', title: 'Second', order: 10 } as any);
    const nav = getNavItems();
    expect(nav.length).toBe(2);
    // n2 should come first because order 10 < 100
    expect(nav[0].id).toBe('n2');
    unregisterNavItem('n2');
    const after = getNavItems();
    expect(after.find((n: { id: string; }) => n.id === 'n2')).toBeUndefined();
  });
});
