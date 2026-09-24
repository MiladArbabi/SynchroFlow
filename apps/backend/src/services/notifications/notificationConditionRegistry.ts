export type NotificationConditionKey =
  | 'orders_cannot_be_fulfilled'
  | 'not_enough_stock_to_fulfill_orders';

export type NotificationConditionUrgency =
  | 'critical'
  | 'important'
  | 'informational';

export type NotificationConditionDefinition = Readonly<{
  key: NotificationConditionKey;
  area: 'fulfillment' | 'inventory';
  merchantLabel: string;
  urgency: NotificationConditionUrgency;
  defaultEnabled: boolean;
  criticalInAppProtection: boolean;
  action: Readonly<{
    route: string;
    label: string;
  }>;
}>;

const DEFINITIONS = Object.freeze({
  orders_cannot_be_fulfilled: Object.freeze({
    key: 'orders_cannot_be_fulfilled',
    area: 'fulfillment',
    merchantLabel: 'Orders cannot be fulfilled',
    urgency: 'critical',
    defaultEnabled: true,
    criticalInAppProtection: true,
    action: Object.freeze({
      route: '/orders',
      label: 'Review orders',
    }),
  } satisfies NotificationConditionDefinition),
  not_enough_stock_to_fulfill_orders: Object.freeze({
    key: 'not_enough_stock_to_fulfill_orders',
    area: 'inventory',
    merchantLabel: 'Not enough stock to fulfill orders',
    urgency: 'important',
    defaultEnabled: true,
    criticalInAppProtection: false,
    action: Object.freeze({
      route: '/orders/flow?constraint=inventory',
      label: 'Resolve stockouts',
    }),
  } satisfies NotificationConditionDefinition),
});

function cloneDefinition(
  definition: NotificationConditionDefinition,
): NotificationConditionDefinition {
  return Object.freeze({
    ...definition,
    action: Object.freeze({ ...definition.action }),
  });
}

export function listNotificationConditions(): NotificationConditionDefinition[] {
  return Object.values(DEFINITIONS).map(cloneDefinition);
}

export function getNotificationCondition(
  conditionKey: string,
): NotificationConditionDefinition | null {
  const definition = DEFINITIONS[conditionKey as NotificationConditionKey];
  return definition ? cloneDefinition(definition) : null;
}
