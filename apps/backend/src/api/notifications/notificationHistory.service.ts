import type { Knex } from 'knex';
import { withTenant } from '@lasyncro/backend-core/db.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type NotificationRow = {
  id: string;
  condition_key: string;
  urgency: string;
  title: string;
  message: string;
  context_json: unknown;
  action_json: unknown | null;
  read_at: Date | string | null;
  clicked_at: Date | string | null;
  created_at: Date | string;
};

export type NotificationRepresentation = {
  id: string;
  condition_key: string;
  urgency: string;
  title: string;
  message: string;
  context: unknown;
  action: unknown | null;
  state: 'unread' | 'read' | 'clicked';
  created_at: string;
  read_at: string | null;
  clicked_at: string | null;
};

export class NotificationHistoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationHistoryInputError';
  }
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

function serializeTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function deriveState(
  readAt: Date | string | null,
  clickedAt: Date | string | null,
): 'unread' | 'read' | 'clicked' {
  if (clickedAt) return 'clicked';
  if (readAt) return 'read';
  return 'unread';
}

function mapNotification(row: NotificationRow): NotificationRepresentation {
  return {
    id: row.id,
    condition_key: row.condition_key,
    urgency: row.urgency,
    title: row.title,
    message: row.message,
    context: parseJsonField(row.context_json, {}),
    action: parseJsonField(row.action_json, null),
    state: deriveState(row.read_at, row.clicked_at),
    created_at: serializeTimestamp(row.created_at)!,
    read_at: serializeTimestamp(row.read_at),
    clicked_at: serializeTimestamp(row.clicked_at),
  };
}

export function parseNotificationId(rawId: unknown): string {
  if (
    typeof rawId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)
  ) {
    throw new NotificationHistoryInputError('notificationId must be a valid UUID');
  }

  return rawId;
}

export function parseRecentLimit(rawLimit: unknown): number {
  if (rawLimit === undefined) return DEFAULT_LIMIT;
  if (Array.isArray(rawLimit)) {
    throw new NotificationHistoryInputError('limit must be an integer');
  }
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit)) {
    throw new NotificationHistoryInputError('limit must be an integer');
  }

  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new NotificationHistoryInputError('limit must be between 1 and 100');
  }

  return limit;
}

function notificationColumns() {
  return [
    'id',
    'condition_key',
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

export async function listRecentNotifications(params: {
  shopId: number;
  userId: number;
  limit: number;
}): Promise<{
  notifications: NotificationRepresentation[];
  unread_count: number;
}> {
  return withTenant(params.shopId, async (trx) => {
    const rows = await trx<NotificationRow>('notification_events')
      .where('shop_id', params.shopId)
      .where('user_id', params.userId)
      .select(...notificationColumns())
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(params.limit);

    const unread = await trx('notification_events')
      .where({
        shop_id: params.shopId,
        user_id: params.userId,
      })
      .whereNull('read_at')
      .whereNull('clicked_at')
      .count<{ count: string }>('id as count')
      .first();

    return {
      notifications: rows.map(mapNotification),
      unread_count: Number(unread?.count ?? 0),
    };
  });
}

async function updateNotification(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    userId: number;
    notificationId: string;
    mode: 'read' | 'click';
  },
): Promise<NotificationRepresentation | null> {
  const update =
    params.mode === 'read'
      ? {
          read_at: trx.raw('COALESCE(read_at, now())'),
        }
      : {
          read_at: trx.raw('COALESCE(read_at, now())'),
          clicked_at: trx.raw('COALESCE(clicked_at, now())'),
        };

  const [row] = await trx<NotificationRow>('notification_events')
    .where('id', params.notificationId)
    .where('shop_id', params.shopId)
    .where('user_id', params.userId)
    .update(update)
    .returning(notificationColumns());

  return row ? mapNotification(row) : null;
}

export async function markNotificationRead(params: {
  shopId: number;
  userId: number;
  notificationId: string;
}): Promise<NotificationRepresentation | null> {
  return withTenant(params.shopId, (trx) =>
    updateNotification(trx, { ...params, mode: 'read' }),
  );
}

export async function markNotificationClicked(params: {
  shopId: number;
  userId: number;
  notificationId: string;
}): Promise<NotificationRepresentation | null> {
  return withTenant(params.shopId, (trx) =>
    updateNotification(trx, { ...params, mode: 'click' }),
  );
}
