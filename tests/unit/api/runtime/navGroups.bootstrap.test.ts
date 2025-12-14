import { getNavigation, _resetNav } from 'runtime/registerNav';
import { bootstrapNavGroups } from 'runtime/navBootstrap';

describe('nav group bootstrap (platform)', () => {
  beforeEach(() => {
    _resetNav();
    bootstrapNavGroups();
  });

  test('platform nav groups exist before modules load', () => {
    const nav = getNavigation();
    const groupIds = nav.map(g => g.id);

    expect(groupIds).toEqual([
      'core',
      'operations',
      'analytics',
      'settings'
    ]);
  });
});
