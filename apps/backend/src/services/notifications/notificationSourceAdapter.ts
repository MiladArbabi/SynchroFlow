import crypto from 'crypto';
import type { Knex } from 'knex';
import { planNotificationDeliveriesInTransaction } from './notificationDeliveryPlanner.service.js';
import { createNotificationOccurrenceInTransaction } from './notificationOccurrence.service.js';

type AlertSourceCandidate = {
  shop_id: number;
  alert_key: string;
  source: string;
  alert_type: string;
  title: string;
  message: string;
  entity_id?: string | null;
  entity_type?: string | null;
  revenue_impact?: number | string | null;
  audience: string;
};

type NotificationConditionKey =
  | 'orders_cannot_be_fulfilled'
  | 'not_enough_stock_to_fulfill_orders';

const CONDITION_BY_ALERT: Record<string, NotificationConditionKey> = {
  'constraint:operational': 'orders_cannot_be_fulfilled',
  'constraint:inventory': 'not_enough_stock_to_fulfill_orders',
};

function conditionForAlert(alert: AlertSourceCandidate): NotificationConditionKey | null {
  return CONDITION_BY_ALERT[`${alert.source}:${alert.alert_type}`] ?? null;
}

function activationFingerprint(alert: AlertSourceCandidate): string {
  return JSON.stringify({
    alert_key: alert.alert_key,
    alert_type: alert.alert_type,
    entity_id: alert.entity_id ?? null,
    entity_type: alert.entity_type ?? null,
    message: alert.message,
    revenue_impact: alert.revenue_impact == null ? null : String(alert.revenue_impact),
    source: alert.source,
    title: alert.title,
  });
}

export async function createNotificationsForAlertActivation(
  trx: Knex.Transaction,
  alert: AlertSourceCandidate,
): Promise<void> {
  if (alert.audience !== 'all') return;

  const conditionKey = conditionForAlert(alert);
  if (!conditionKey) return;

  const memberships = await trx('shop_memberships')
    .where({
      shop_id: alert.shop_id,
    })
    .whereNull('revoked_at')
    .select('user_id');

  if (memberships.length === 0) return;

  const occurrenceKey = [
    'constraint-alert-activation',
    alert.alert_key,
    crypto.randomUUID(),
  ].join(':');
  const sourceFingerprint = activationFingerprint(alert);

  for (const membership of memberships) {
    const result = await createNotificationOccurrenceInTransaction(trx, {
      shopId: alert.shop_id,
      userId: Number(membership.user_id),
      conditionKey,
      sourceType: 'alert',
      sourceId: alert.alert_key,
      occurrenceKey,
      sourceFingerprint,
      title: alert.title,
      message: alert.message,
      context: {
        alert_key: alert.alert_key,
        alert_type: alert.alert_type,
        entity_id: alert.entity_id ?? null,
        entity_type: alert.entity_type ?? null,
        revenue_impact: alert.revenue_impact == null ? null : String(alert.revenue_impact),
        source: alert.source,
      },
    });

    if (result.status === 'created') {
      await planNotificationDeliveriesInTransaction(trx, result.notification);
    }
  }
}
