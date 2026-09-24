import type { Knex } from 'knex';
import { getNotificationCondition } from './notificationConditionRegistry.js';
import {
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from './notificationPreferences.js';
import type { NotificationOccurrence } from './notificationOccurrence.service.js';

type Channel = 'in_app' | 'push' | 'email';

export type PlanNotificationDeliveriesResult =
  | { status: 'planned' }
  | {
      status: 'skipped';
      reason: 'event_not_found' | 'event_identity_mismatch' | 'inactive_membership';
    };

function conditionSetting(
  preferences: NotificationPreferences,
  conditionKey: string,
): Record<string, unknown> {
  const setting = preferences.conditions[conditionKey];
  if (
    typeof setting === 'object' &&
    setting !== null &&
    !Array.isArray(setting)
  ) {
    return setting;
  }
  return {};
}

// Global push/email are master channel gates: a per-condition `true` never
// re-enables a globally disabled channel; a per-condition `false` can only
// narrow an enabled one. Mirrored by channelEnabled() in JIT execution.
function effectiveChannelEnabled(params: {
  preferences: NotificationPreferences;
  conditionKey: string;
  channel: 'push' | 'email';
}): boolean {
  if (params.preferences.channels[params.channel] !== true) return false;

  const setting = conditionSetting(params.preferences, params.conditionKey);
  return setting[params.channel] !== false;
}

function externalChannelsSuppressed(params: {
  preferences: NotificationPreferences;
  conditionKey: string;
}): boolean {
  const condition = getNotificationCondition(params.conditionKey);
  if (!condition?.criticalInAppProtection) return false;

  const setting = conditionSetting(params.preferences, params.conditionKey);
  return setting.enabled === false;
}

async function hasPushSubscription(
  trx: Knex.Transaction,
  shopId: number,
  userId: number,
): Promise<boolean> {
  const row = await trx('push_subscriptions')
    .where({ shop_id: shopId, user_id: userId })
    .first('id');

  return Boolean(row);
}

async function hasUsableEmail(
  trx: Knex.Transaction,
  shopId: number,
  userId: number,
): Promise<boolean> {
  const user = await trx('users')
    .where({ shop_id: shopId, id: userId })
    .first('email');

  return typeof user?.email === 'string' && user.email.trim().length > 0;
}

async function loadPreferences(
  trx: Knex.Transaction,
  shopId: number,
  userId: number,
): Promise<NotificationPreferences | null> {
  const membership = await trx('shop_memberships')
    .where({ shop_id: shopId, user_id: userId })
    .whereNull('revoked_at')
    .first('notification_preferences');

  if (!membership) return null;
  return normalizeNotificationPreferences(membership?.notification_preferences);
}

export async function planNotificationDeliveriesInTransaction(
  trx: Knex.Transaction,
  notificationEvent: NotificationOccurrence,
): Promise<PlanNotificationDeliveriesResult> {
  const persistedEvent = await trx('notification_events')
    .where({ id: notificationEvent.id })
    .first('shop_id', 'user_id', 'condition_key');

  if (!persistedEvent) {
    return { status: 'skipped', reason: 'event_not_found' };
  }

  if (
    Number(persistedEvent.shop_id) !== notificationEvent.shopId ||
    Number(persistedEvent.user_id) !== notificationEvent.userId ||
    persistedEvent.condition_key !== notificationEvent.conditionKey
  ) {
    return { status: 'skipped', reason: 'event_identity_mismatch' };
  }

  const preferences = await loadPreferences(
    trx,
    notificationEvent.shopId,
    notificationEvent.userId,
  );
  if (!preferences) {
    return { status: 'skipped', reason: 'inactive_membership' };
  }

  const plannedAt = new Date();
  const deliveries: Array<{
    notification_event_id: string;
    channel: Channel;
    status: 'queued' | 'delivered';
    attempt_count: number;
    next_attempt_at: Date | null;
    sent_at: Date | null;
    delivered_at: Date | null;
  }> = [
    {
      notification_event_id: notificationEvent.id,
      channel: 'in_app',
      status: 'delivered',
      attempt_count: 0,
      next_attempt_at: null,
      sent_at: plannedAt,
      delivered_at: plannedAt,
    },
  ];

  if (!externalChannelsSuppressed({
    preferences,
    conditionKey: notificationEvent.conditionKey,
  })) {
    if (
      effectiveChannelEnabled({
        preferences,
        conditionKey: notificationEvent.conditionKey,
        channel: 'push',
      }) &&
      await hasPushSubscription(trx, notificationEvent.shopId, notificationEvent.userId)
    ) {
      deliveries.push({
        notification_event_id: notificationEvent.id,
        channel: 'push',
        status: 'queued',
        attempt_count: 0,
        next_attempt_at: plannedAt,
        sent_at: null,
        delivered_at: null,
      });
    }

    if (
      effectiveChannelEnabled({
        preferences,
        conditionKey: notificationEvent.conditionKey,
        channel: 'email',
      }) &&
      await hasUsableEmail(trx, notificationEvent.shopId, notificationEvent.userId)
    ) {
      deliveries.push({
        notification_event_id: notificationEvent.id,
        channel: 'email',
        status: 'queued',
        attempt_count: 0,
        next_attempt_at: plannedAt,
        sent_at: null,
        delivered_at: null,
      });
    }
  }

  await trx('notification_deliveries')
    .insert(deliveries)
    .onConflict(['notification_event_id', 'channel'])
    .ignore();

  return { status: 'planned' };
}
