// tests/unit/ui/components/route-entitlements.test.tsx
import React from 'react';
import {
  RouteConfig,
  EntitlementSnapshot,
  isRouteEnabled,
  filterRoutesByEntitlements,
} from 'routes';

describe('route entitlement helpers', () => {
  const baseRoutes: RouteConfig[] = [
    {
      type: 'collapse',
      name: 'Public Dashboard',
      key: 'public-dashboard',
      route: '/public-dashboard',
      icon: '🏠',
      component: <div />,
      // no requiredModuleId / requiredFlagId
    },
    {
      type: 'collapse',
      name: 'Analytics',
      key: 'analytics',
      route: '/analytics',
      icon: '📈',
      component: <div />,
      requiredModuleId: 'analytics-hub',
    },
    {
      type: 'collapse',
      name: 'Product Intelligence (beta)',
      key: 'product-intelligence',
      route: '/product-intelligence',
      icon: '💡',
      component: <div />,
      requiredModuleId: 'product-intelligence',
      requiredFlagId: 'beta-product-intel',
    },
  ];

  const fullEntitlements: EntitlementSnapshot = {
    modules: ['analytics-hub', 'product-intelligence'],
    flags: ['beta-product-intel'],
  };

  it('treats routes with no entitlement metadata as always enabled', () => {
    const publicRoute = baseRoutes[0];

    expect(isRouteEnabled(publicRoute, null)).toBe(true);
    expect(isRouteEnabled(publicRoute, { modules: [], flags: [] })).toBe(true);
    expect(isRouteEnabled(publicRoute, fullEntitlements)).toBe(true);
  });

  it('hides gated routes when entitlements are null (conservative default)', () => {
    const analyticsRoute = baseRoutes[1];

    expect(isRouteEnabled(analyticsRoute, null)).toBe(false);

    const visible = filterRoutesByEntitlements(baseRoutes, null);
    // Only the public route should remain
    expect(visible.map((r) => r.key)).toEqual(['public-dashboard']);
  });

  it('respects requiredModuleId when entitlements are present', () => {
    const analyticsRoute = baseRoutes[1];

    // No analytics module granted
    const entitlements: EntitlementSnapshot = {
      modules: ['some-other-module'],
      flags: [],
    };
    expect(isRouteEnabled(analyticsRoute, entitlements)).toBe(false);

    // Analytics module granted
    const entitlementsWithAnalytics: EntitlementSnapshot = {
      modules: ['analytics-hub'],
      flags: [],
    };
    expect(isRouteEnabled(analyticsRoute, entitlementsWithAnalytics)).toBe(true);
  });

  it('requires both module and flag when both are specified', () => {
    const productIntelRoute = baseRoutes[2];

    // Missing both
    expect(
      isRouteEnabled(productIntelRoute, { modules: [], flags: [] })
    ).toBe(false);

    // Has module, missing flag
    expect(
      isRouteEnabled(productIntelRoute, {
        modules: ['product-intelligence'],
        flags: [],
      })
    ).toBe(false);

    // Has flag, missing module
    expect(
      isRouteEnabled(productIntelRoute, {
        modules: [],
        flags: ['beta-product-intel'],
      })
    ).toBe(false);

    // Has both → enabled
    expect(isRouteEnabled(productIntelRoute, fullEntitlements)).toBe(true);
  });

  it('filterRoutesByEntitlements returns only routes allowed by entitlements', () => {
    const entitlements: EntitlementSnapshot = {
      modules: ['analytics-hub'],
      flags: [],
    };

    const visible = filterRoutesByEntitlements(baseRoutes, entitlements);

    // Public + analytics, but not product-intelligence (missing module+flag combo)
    expect(visible.map((r) => r.key).sort()).toEqual(
      ['public-dashboard', 'analytics'].sort()
    );
  });
});