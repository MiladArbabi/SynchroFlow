// tests/unit/ui/routes/routes.lifecycle-ownership.test.ts
import routes, { isRouteEnabled } from 'routes';

describe('routes.tsx — lifecycle ownership', () => {
  it('does not encode lifecycle, FT phases, or onboarding semantics', () => {
    for (const route of routes) {
      // @ts-expect-error — these must NEVER exist
      expect((route as any).lifecyclePhase).toBeUndefined();

      // @ts-expect-error
      expect((route as any).ftPhase).toBeUndefined();

      // @ts-expect-error
      expect((route as any).readiness).toBeUndefined();

      // @ts-expect-error
      expect((route as any).onboardingTier).toBeUndefined();
    }
  });

  it('isRouteEnabled only depends on entitlements (modules + flags)', () => {
    const route = routes[0];

    const entitlements = {
      modules: [],
      flags: [],
      // 🔴 poison pills — must be ignored
      lifecyclePhase: 'FT2',
      ftPhase: 'FT1',
      readiness: { isComplete: true },
    } as any;

    expect(() => isRouteEnabled(route, entitlements)).not.toThrow();
  });
});
