import {
  registerNavItem,
  registerNavGroup,
  getNavigation,
  unregisterNavItem,
  unregisterNavGroup,
  _resetNav
} from 'runtime/registerNav';

describe('nav registry (runtime)', () => {
  afterEach(() => _resetNav());

  test('register + unregister group', () => {
    registerNavGroup({ id: 'core', label: 'Core', order: 1 });
    let nav = getNavigation();
    expect(nav.length).toBe(1);

    unregisterNavGroup('core');
    nav = getNavigation();
    expect(nav.length).toBe(0);
  });

  test('items attach to groups + sorted', () => {
    registerNavGroup({ id: 'core', label: 'Core', order: 1 });

    registerNavItem({ id: 'b', label: 'B', path: '/b', group: 'core', order: 20 });
    registerNavItem({ id: 'a', label: 'A', path: '/a', group: 'core', order: 10 });

    const nav = getNavigation();
    const group = nav[0];

    expect(group.items!.map(i => i.id)).toEqual(['a', 'b']);
  });
});
