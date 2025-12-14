import {
  registerRoute,
  getRegisteredRoutes,
  _resetRoutes
} from 'runtime/registerRoute';

describe('route registry reset', () => {
  afterEach(() => _resetRoutes());

  it('clears all dynamically registered routes', () => {
    registerRoute({
      id: 'test-route',
      path: '/test',
      component: () => null
    });

    expect(
      getRegisteredRoutes().some(r => r.id === 'test-route')
    ).toBe(true);

    _resetRoutes();

    expect(
      getRegisteredRoutes().some(r => r.id === 'test-route')
    ).toBe(false);
  });
});
