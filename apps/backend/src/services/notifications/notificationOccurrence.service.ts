import { withTenant } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import { evaluateNotificationEligibility } from './notificationEligibility.service.js';

type NotificationEventRow = {
  id: string;
  shop_id: number;
  user_id: number;
  condition_key: string;
  source_type: string;
  source_id: string | null;
  occurrence_key: string;
  source_fingerprint: string;
  urgency: string;
  title: string;
  message: string;
  context_json: unknown;
  action_json: unknown | null;
  read_at: Date | string | null;
  clicked_at: Date | string | null;
  created_at: Date | string;
};

export type NotificationOccurrence = {
  id: string;
  shopId: number;
  userId: number;
  conditionKey: string;
  urgency: string;
  title: string;
  message: string;
  context: unknown;
  action: unknown | null;
  createdAt: string;
};

export type CreateNotificationOccurrenceResult =
  | {
      status: 'created' | 'duplicate';
      notification: NotificationOccurrence;
    }
  | {
      status: 'suppressed';
      reason:
        | 'unknown_condition'
        | 'inactive_membership'
        | 'condition_disabled'
        | 'urgency_filtered';
    }
  | {
      status: 'conflict';
      reason: 'source_fingerprint_changed';
      notification: NotificationOccurrence;
    };

export type CreateNotificationOccurrenceInput = {
  shopId: number;
  userId: number;
  conditionKey: string;
  sourceType: string;
  sourceId?: string | null;
  occurrenceKey: string;
  sourceFingerprint: string;
  title: string;
  message: string;
  context?: Record<string, unknown>;
};

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function parseJsonField(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapNotification(row: NotificationEventRow): NotificationOccurrence {
  return {
    id: row.id,
    shopId: row.shop_id,
    userId: row.user_id,
    conditionKey: row.condition_key,
    urgency: row.urgency,
    title: row.title,
    message: row.message,
    context: parseJsonField(row.context_json, {}),
    action: parseJsonField(row.action_json, null),
    createdAt: toIso(row.created_at),
  };
}

function eventColumns() {
  return [
    'id',
    'shop_id',
    'user_id',
    'condition_key',
    'source_type',
    'source_id',
    'occurrence_key',
    'source_fingerprint',
    'urgency',
    'title',
    'message',
    'context_json',
    'action_json',
    'read_at',
    'clicked_at',
    'created_at',
  ] as const;
}

export async function createNotificationOccurrence(
  input: CreateNotificationOccurrenceInput,
): Promise<CreateNotificationOccurrenceResult> {
  return withTenant(input.shopId, (trx) =>
    createNotificationOccurrenceInTransaction(trx, input),
  );
}

export async function createNotificationOccurrenceInTransaction(
  trx: Knex.Transaction,
  input: CreateNotificationOccurrenceInput,
): Promise<CreateNotificationOccurrenceResult> {
  const conditionKey = assertNonEmpty(input.conditionKey, 'conditionKey');
  const sourceType = assertNonEmpty(input.sourceType, 'sourceType');
  const occurrenceKey = assertNonEmpty(input.occurrenceKey, 'occurrenceKey');
  const sourceFingerprint = assertNonEmpty(
    input.sourceFingerprint,
    'sourceFingerprint',
  );
  const title = assertNonEmpty(input.title, 'title');
  const message = assertNonEmpty(input.message, 'message');

  const membership = await trx('shop_memberships')
    .where({
      shop_id: input.shopId,
      user_id: input.userId,
    })
    .whereNull('revoked_at')
    .first('notification_preferences');

  if (!membership) {
    return { status: 'suppressed', reason: 'inactive_membership' };
  }

  const eligibility = evaluateNotificationEligibility({
    conditionKey,
    preferences: membership.notification_preferences,
  });

  if (!eligibility.eligible) {
    return { status: 'suppressed', reason: eligibility.reason };
  }

  const [inserted] = await trx<NotificationEventRow>('notification_events')
    .insert({
      shop_id: input.shopId,
      user_id: input.userId,
      condition_key: eligibility.condition.key,
      source_type: sourceType,
      source_id: input.sourceId ?? null,
      occurrence_key: occurrenceKey,
      source_fingerprint: sourceFingerprint,
      urgency: eligibility.condition.urgency,
      title,
      message,
      context_json: JSON.stringify(input.context ?? {}),
      action_json: JSON.stringify(eligibility.condition.action),
      read_at: null,
      clicked_at: null,
    })
    .onConflict(['shop_id', 'user_id', 'occurrence_key'])
    .ignore()
    .returning(eventColumns());

  if (inserted) {
    return {
      status: 'created',
      notification: mapNotification(inserted),
    };
  }

  const existing = await trx<NotificationEventRow>('notification_events')
    .where({
      shop_id: input.shopId,
      user_id: input.userId,
      occurrence_key: occurrenceKey,
    })
    .first(...eventColumns());

  if (!existing) {
    throw new Error('NOTIFICATION_OCCURRENCE_CONFLICT_LOOKUP_FAILED');
  }

  if (existing.source_fingerprint !== sourceFingerprint) {
    return {
      status: 'conflict',
      reason: 'source_fingerprint_changed',
      notification: mapNotification(existing),
    };
  }

  return {
    status: 'duplicate',
    notification: mapNotification(existing),
  };
}
