import {
  getNotificationCondition,
  listNotificationConditions,
} from 'api-src/services/notifications/notificationConditionRegistry';
import {
  evaluateNotificationEligibility,
  urgencyAllowsNotification,
} from 'api-src/services/notifications/notificationEligibility.service';

describe('GH-1147 notification condition registry and eligibility', () => {
  it('registers only the two approved condition definitions', () => {
    const conditions = listNotificationConditions();

    expect(conditions.map((condition) => condition.key).sort()).toEqual([
      'not_enough_stock_to_fulfill_orders',
      'orders_cannot_be_fulfilled',
    ]);

    expect(getNotificationCondition('orders_cannot_be_fulfilled')).toEqual({
      key: 'orders_cannot_be_fulfilled',
      area: 'fulfillment',
      merchantLabel: 'Orders cannot be fulfilled',
      urgency: 'critical',
      defaultEnabled: true,
      criticalInAppProtection: true,
      action: {
        route: '/orders',
        label: 'Review orders',
      },
    });

    expect(getNotificationCondition('not_enough_stock_to_fulfill_orders')).toEqual({
      key: 'not_enough_stock_to_fulfill_orders',
      area: 'inventory',
      merchantLabel: 'Not enough stock to fulfill orders',
      urgency: 'important',
      defaultEnabled: true,
      criticalInAppProtection: false,
      action: {
        route: '/orders/flow?constraint=inventory',
        label: 'Resolve stockouts',
      },
    });
  });

  it('fails closed for unknown condition keys', () => {
    expect(getNotificationCondition('delivery_overdue')).toBeNull();
    expect(
      evaluateNotificationEligibility({
        conditionKey: 'delivery_overdue',
      }),
    ).toEqual({
      eligible: false,
      reason: 'unknown_condition',
    });
  });

  it('returns immutable registry definitions in behavior', () => {
    const first = getNotificationCondition('orders_cannot_be_fulfilled');
    expect(first).toBeTruthy();

    try {
      (first as any).merchantLabel = 'Mutated';
      (first as any).action.route = '/mutated';
    } catch {
      // Frozen definitions may throw in strict mode; either way they must not mutate.
    }

    const second = getNotificationCondition('orders_cannot_be_fulfilled');
    expect(second?.merchantLabel).toBe('Orders cannot be fulfilled');
    expect(second?.action.route).toBe('/orders');
  });

  it('applies global urgency filtering', () => {
    expect(urgencyAllowsNotification('critical_only', 'critical')).toBe(true);
    expect(urgencyAllowsNotification('critical_only', 'important')).toBe(false);
    expect(urgencyAllowsNotification('important_critical', 'critical')).toBe(true);
    expect(urgencyAllowsNotification('important_critical', 'important')).toBe(true);
    expect(urgencyAllowsNotification('important_critical', 'informational')).toBe(false);
    expect(urgencyAllowsNotification('all', 'critical')).toBe(true);
    expect(urgencyAllowsNotification('all', 'important')).toBe(true);
    expect(urgencyAllowsNotification('all', 'informational')).toBe(true);

    const criticalOnlyInventory = evaluateNotificationEligibility({
      conditionKey: 'not_enough_stock_to_fulfill_orders',
      preferences: {
        urgency: 'critical_only',
      },
    });

    expect(criticalOnlyInventory).toEqual(
      expect.objectContaining({
        eligible: false,
        reason: 'urgency_filtered',
      }),
    );
  });

  it('keeps critical protected in-app notifications eligible when disabled', () => {
    const result = evaluateNotificationEligibility({
      conditionKey: 'orders_cannot_be_fulfilled',
      preferences: {
        conditions: {
          orders_cannot_be_fulfilled: {
            enabled: false,
          },
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        eligible: true,
        reason: 'eligible',
      }),
    );
  });

  it('suppresses noncritical disabled conditions', () => {
    const result = evaluateNotificationEligibility({
      conditionKey: 'not_enough_stock_to_fulfill_orders',
      preferences: {
        conditions: {
          not_enough_stock_to_fulfill_orders: {
            enabled: false,
          },
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        eligible: false,
        reason: 'condition_disabled',
      }),
    );
  });

  it('keeps default preferences eligible for both registered conditions', () => {
    expect(
      evaluateNotificationEligibility({
        conditionKey: 'orders_cannot_be_fulfilled',
      }),
    ).toEqual(
      expect.objectContaining({
        eligible: true,
      }),
    );

    expect(
      evaluateNotificationEligibility({
        conditionKey: 'not_enough_stock_to_fulfill_orders',
      }),
    ).toEqual(
      expect.objectContaining({
        eligible: true,
      }),
    );
  });
});
