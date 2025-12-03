// tests/unit/ui/widgets/widget-registry.test.ts
import { getWidgetsForUser } from 'components/widgets/widget-registry';

describe('getWidgetsForUser', () => {
  it('filters out paid widgets for free plan users', () => {
    const widgets = getWidgetsForUser({
      detected_mode: 'survival',
      plan: 'free',
    });

    const ids = widgets.map((w) => w.id);

    // Advanced Analytics is the paid widget
    expect(ids).not.toContain('advanced-analytics');

    // Sanity: we still return the core free widgets
    expect(ids).toEqual(
      expect.arrayContaining([
        'cash-flow',
        'inventory-alerts',
        'order-metrics',
        'top-products',
        'sales-by-traffic-source',
      ])
    );
  });

  it('includes paid widgets for premium plan users', () => {
    const widgets = getWidgetsForUser({
      detected_mode: 'survival',
      plan: 'premium',
    });

    const ids = widgets.map((w) => w.id);

    expect(ids).toContain('advanced-analytics');
  });

  it('sorts survival widgets by priority (critical → high → medium → low)', () => {
    const widgets = getWidgetsForUser({
      detected_mode: 'survival',
      plan: 'premium',
    });

    const priorities = widgets.map((w) => w.priority);

    // Map textual priority to numeric ordering
    const order: Record<(typeof priorities)[number], number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    const numeric = priorities.map((p) => order[p]);
    const sortedCopy = [...numeric].sort((a, b) => a - b);

    expect(numeric).toEqual(sortedCopy);
    expect(priorities[0]).toBe('critical');
    expect(priorities[priorities.length - 1]).toBe('low');
  });

  it('returns an empty array for unsupported modes (runtime guard)', () => {
    const widgets = getWidgetsForUser({
      // Step outside TS here on purpose to test runtime behaviour
      detected_mode: 'unknown-mode' as any,
      plan: 'free',
    });

    expect(widgets).toEqual([]);
  });

    it('hides widgets that require modules when user lacks entitlement', () => {
    const user = {
      detected_mode: 'survival' as const,
      plan: 'premium' as const,
    };

    const widgets = getWidgetsForUser(user, {
      hasModule: () => false,
    });

    const advanced = widgets.find((w) => w.id === 'advanced-analytics');
    expect(advanced).toBeUndefined();
  });

  it('shows widgets that require modules when user has entitlement', () => {
    const user = {
      detected_mode: 'survival' as const,
      plan: 'premium' as const,
    };

    const widgets = getWidgetsForUser(user, {
      hasModule: (id) => id === 'advanced-analytics',
    });

    const advanced = widgets.find((w) => w.id === 'advanced-analytics');
    expect(advanced).toBeDefined();
  });
});
