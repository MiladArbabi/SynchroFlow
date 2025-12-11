//tests/unit/api/runtime/routeRegistry.test.ts
import { registerRoute, unregisterRoute, getRegisteredRoutes } from 'ui/src/runtime/registerRoute';

describe('route registry (runtime)', () => {
  const TEST_ROUTE = {
    id: 'test-route',
    name: 'Test',
    path: '/__test-route',
    type: 'route',
    component: () => null,
    order: 9999
  };

  afterEach(() => {
    try { unregisterRoute(TEST_ROUTE.id); } catch {}
  });

  test('registerRoute adds a route and unregisterRoute removes it', () => {
    registerRoute(TEST_ROUTE as any);
    const all = getRegisteredRoutes();
    const found = all.find((r) => r.id === TEST_ROUTE.id || r.path === TEST_ROUTE.path);
    expect(found).toBeDefined();
    // cleanup
    unregisterRoute(TEST_ROUTE.id);
    const after = getRegisteredRoutes();
    expect(after.find((r) => r.id === TEST_ROUTE.id)).toBeUndefined();
  });

  test('getRegisteredRoutes returns a merged list including static routes', () => {
    const all = getRegisteredRoutes();
    expect(Array.isArray(all)).toBe(true);
    // there should be at least one static route like '/dashboard'
    expect(all.some((r) => typeof r.path === 'string' && r.path === '/dashboard')).toBeTruthy();
  });
});
