import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import { performance } from 'node:perf_hooks';
import { getNotificationCondition } from './notificationConditionRegistry.js';
import {
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from './notificationPreferences.js';
import { resolveQuietHoursDecision } from './notificationQuietHours.service.js';

export const NOTIFICATION_DELIVERY_BATCH_SIZE = 25;
export const NOTIFICATION_DELIVERY_LEASE_SECONDS = 60;
export const NOTIFICATION_DELIVERY_POLL_INTERVAL_MS = 5_000;
export const NOTIFICATION_PROVIDER_TIMEOUT_MS = 20_000;
export const NOTIFICATION_PROVIDER_LEASE_SAFETY_MS = 5_000;
export const NOTIFICATION_PROVIDER_MIN_BUDGET_MS = 5_000;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const FALLBACK_RETRY_MS = [30_000, 120_000, 600_000];

export type NotificationDeliveryLocator = {
  delivery_id: string;
  shop_id: number;
  claim_token: string;
};

export type PushDestination = Readonly<{
  id: string;
  updatedAt: string;
} & (
  | { kind: 'web'; endpoint: string | null; p256dh: string | null; auth: string | null }
  | { kind: 'expo'; expoPushToken: string | null }
)>;

export type PreparedDelivery = Readonly<{
  deliveryId: string;
  notificationEventId: string;
  shopId: number;
  userId: number;
  title: string;
  body: string;
  action: Readonly<{ route: string; label: string }> | null;
} & (
  | { channel: 'push'; destinations: readonly PushDestination[] }
  | { channel: 'email'; recipient: string }
)>;

export type DeliveryTransportResult = (
  | {
      kind: 'accepted';
      providerMessageId?: string | null;
    }
  | {
      kind: 'retryable_failure';
      error: string;
      retryAfterMs?: number;
    }
  | {
      kind: 'terminal_failure';
      error: string;
      terminalReason: string;
    }
) & { deadDestinations?: readonly PushDestination[] };

export type DeliveryTransport = (delivery: Readonly<PreparedDelivery>, control: {
  signal: AbortSignal;
  deadlineAt: number;
}) => Promise<DeliveryTransportResult>;

export type ExecuteDeliveryResult =
  | { status: 'sent' }
  | { status: 'queued'; reason: 'retryable_failure' | 'quiet_hours' | 'lease_budget' }
  | { status: 'failed'; reason: string }
  | { status: 'cancelled'; reason: string }
  | { status: 'stale_claim' }
  | { status: 'not_found' };

type DeliveryContext = {
  id: string;
  channel: 'push' | 'email' | 'in_app';
  attempt_count: number;
  notification_event_id: string;
  status: string;
  claim_token: string | null;
  claim_expires_at: Date | string | null;
  last_attempt_at: Date | string | null;
  shop_id: number;
  user_id: number;
  condition_key: string;
  urgency: string;
  read_at: Date | string | null;
  clicked_at: Date | string | null;
  email: string | null;
  membership_user_id: number | null;
  revoked_at: Date | string | null;
  notification_preferences: unknown;
  timezone: string | null;
  title: string;
  message: string;
  action_json: { route: string; label: string } | null;
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

// Same master-gate rule as the planner's effectiveChannelEnabled(): global
// OFF wins over any per-condition `true`, so a delivery queued while the
// channel was ON is cancelled if the merchant has since turned it OFF.
function channelEnabled(
  preferences: NotificationPreferences,
  conditionKey: string,
  channel: 'push' | 'email',
): boolean {
  if (preferences.channels[channel] !== true) return false;

  return conditionSetting(preferences, conditionKey)[channel] !== false;
}

function conditionDisabledForExternal(
  preferences: NotificationPreferences,
  conditionKey: string,
): boolean {
  return conditionSetting(preferences, conditionKey).enabled === false;
}

function retryInstant(attemptCount: number, result: Extract<DeliveryTransportResult, { kind: 'retryable_failure' }>, now: Date): Date {
  if (
    typeof result.retryAfterMs === 'number' &&
    Number.isFinite(result.retryAfterMs) &&
    result.retryAfterMs > 0
  ) {
    return new Date(now.getTime() + Math.min(result.retryAfterMs, MAX_RETRY_AFTER_MS));
  }

  return new Date(now.getTime() + (FALLBACK_RETRY_MS[attemptCount - 1] ?? FALLBACK_RETRY_MS[FALLBACK_RETRY_MS.length - 1]));
}

async function fencedUpdate(
  trx: Knex.Transaction,
  locator: NotificationDeliveryLocator,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const count = await trx('notification_deliveries')
    .where({
      id: locator.delivery_id,
      status: 'processing',
      claim_token: locator.claim_token,
    })
    .update({
      ...patch,
      updated_at: trx.fn.now(),
    });

  return count === 1;
}

async function fetchContext(
  trx: Knex.Transaction,
  locator: NotificationDeliveryLocator,
): Promise<DeliveryContext | null> {
  return trx('notification_deliveries as d')
    .join('notification_events as e', 'e.id', 'd.notification_event_id')
    .leftJoin('shop_memberships as m', function joinMembership() {
      this.on('m.shop_id', 'e.shop_id')
        .andOn('m.user_id', 'e.user_id');
    })
    .join('users as u', function joinUser() {
      this.on('u.shop_id', 'e.shop_id')
        .andOn('u.id', 'e.user_id');
    })
    .join('shops as s', 's.id', 'e.shop_id')
    .where({
      'd.id': locator.delivery_id,
      'd.status': 'processing',
      'd.claim_token': locator.claim_token,
      'e.shop_id': locator.shop_id,
    })
    .first([
      'd.id',
      'd.channel',
      'd.attempt_count',
      'd.notification_event_id',
      'd.status',
      'd.claim_token',
      'd.claim_expires_at',
      'd.last_attempt_at',
      'e.shop_id',
      'e.user_id',
      'e.condition_key',
      'e.urgency',
      'e.read_at',
      'e.clicked_at',
      'e.title',
      'e.message',
      'e.action_json',
      'u.email',
      'm.user_id as membership_user_id',
      'm.revoked_at',
      'm.notification_preferences',
      's.timezone',
    ]);
}

async function snapshotPushDestinations(
  trx: Knex.Transaction,
  shopId: number,
  userId: number,
): Promise<readonly PushDestination[]> {
  const rows: Array<{
    id: string; device_type: 'web' | 'expo'; updated_at: string;
    endpoint: string | null; p256dh: string | null; auth: string | null;
    expo_push_token: string | null;
  }> = await trx('push_subscriptions')
    .where({ shop_id: shopId, user_id: userId })
    .select('id', 'device_type', 'endpoint', 'p256dh', 'auth', 'expo_push_token',
      // Preserve PostgreSQL microseconds for compare-delete, rather than JS Date precision.
      trx.raw('updated_at::text as updated_at'));
  return Object.freeze(rows.map((row): PushDestination => Object.freeze(row.device_type === 'web'
    ? { kind: 'web', id: row.id, updatedAt: row.updated_at, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }
    : { kind: 'expo', id: row.id, updatedAt: row.updated_at, expoPushToken: row.expo_push_token })));
}

async function cancelDelivery(
  trx: Knex.Transaction,
  locator: NotificationDeliveryLocator,
  reason: string,
): Promise<ExecuteDeliveryResult> {
  const ok = await fencedUpdate(trx, locator, {
    status: 'cancelled',
    cancelled_at: trx.fn.now(),
    terminal_reason: reason,
    claim_token: null,
    claim_expires_at: null,
  });
  return ok ? { status: 'cancelled', reason } : { status: 'stale_claim' };
}

async function requeueForLeaseBudget(
  trx: Knex.Transaction,
  locator: NotificationDeliveryLocator,
  previousAttempt?: Pick<DeliveryContext, 'attempt_count' | 'last_attempt_at'>,
): Promise<ExecuteDeliveryResult> {
  const ok = await fencedUpdate(trx, locator, {
    ...previousAttempt,
    status: 'queued',
    next_attempt_at: null,
    claim_token: null,
    claim_expires_at: null,
  });
  return ok ? { status: 'queued', reason: 'lease_budget' } : { status: 'stale_claim' };
}

export async function claimNotificationDeliveries(params: {
  limit?: number;
  leaseSeconds?: number;
} = {}): Promise<NotificationDeliveryLocator[]> {
  const result = await systemQuery(
    db.raw(
      'SELECT delivery_id, shop_id, claim_token FROM public.claim_notification_deliveries(?, ?)',
      [
        params.limit ?? NOTIFICATION_DELIVERY_BATCH_SIZE,
        params.leaseSeconds ?? NOTIFICATION_DELIVERY_LEASE_SECONDS,
      ],
    ),
  );

  return (result.rows ?? []).map((row: any) => ({
    delivery_id: String(row.delivery_id),
    shop_id: Number(row.shop_id),
    claim_token: String(row.claim_token),
  }));
}

export async function executeClaimedNotificationDelivery(params: {
  locator: NotificationDeliveryLocator;
  transport: DeliveryTransport;
  now?: Date;
}): Promise<ExecuteDeliveryResult> {
  const now = params.now ?? new Date();
  const startedAt = performance.now();
  // Include preflight/commit elapsed time even when policy time is supplied.
  const remainingBudget = (deadlineAt: number) =>
    deadlineAt - now.getTime() - (performance.now() - startedAt);

  const preflight = await withTenant(params.locator.shop_id, async (trx): Promise<
    ExecuteDeliveryResult | {
      status: 'prepared';
      context: DeliveryContext & { channel: 'push' | 'email' };
      delivery: PreparedDelivery;
      deadlineAt: number;
      previousAttempt: Pick<DeliveryContext, 'attempt_count' | 'last_attempt_at'>;
    }
  > => {
    const context = await fetchContext(trx, params.locator);
    if (!context) return { status: 'not_found' } satisfies ExecuteDeliveryResult;
    if (context.membership_user_id == null || context.revoked_at) {
      return cancelDelivery(trx, params.locator, 'membership_inactive');
    }
    if (context.channel === 'in_app') {
      return cancelDelivery(trx, params.locator, 'channel_disabled');
    }

    const preferences = normalizeNotificationPreferences(context.notification_preferences);
    const condition = getNotificationCondition(context.condition_key);
    if (!condition) return cancelDelivery(trx, params.locator, 'condition_disabled');
    if (!channelEnabled(preferences, context.condition_key, context.channel)) {
      return cancelDelivery(trx, params.locator, 'channel_disabled');
    }
    if (conditionDisabledForExternal(preferences, context.condition_key)) {
      return cancelDelivery(trx, params.locator, 'condition_disabled');
    }
    const destinations = context.channel === 'push'
      ? await snapshotPushDestinations(trx, context.shop_id, context.user_id)
      : [];
    if (context.channel === 'push' && destinations.length === 0) {
      return cancelDelivery(trx, params.locator, 'no_destination');
    }
    if (
      context.channel === 'email' &&
      (typeof context.email !== 'string' || context.email.trim().length === 0)
    ) {
      return cancelDelivery(trx, params.locator, 'no_destination');
    }
    if (context.read_at || context.clicked_at) {
      return cancelDelivery(trx, params.locator, 'already_seen');
    }

    const quiet = resolveQuietHoursDecision({
      timezone: context.timezone,
      preferences,
      urgency: context.urgency,
      now,
    });
    if (!quiet.executable) {
      const ok = await fencedUpdate(trx, params.locator, {
        status: 'queued',
        next_attempt_at: quiet.nextAttemptAt,
        claim_token: null,
        claim_expires_at: null,
      });
      return ok
        ? { status: 'queued', reason: 'quiet_hours' } satisfies ExecuteDeliveryResult
        : { status: 'stale_claim' } satisfies ExecuteDeliveryResult;
    }

    if (context.attempt_count >= MAX_ATTEMPTS) {
      const ok = await fencedUpdate(trx, params.locator, {
        status: 'failed',
        failed_at: trx.fn.now(),
        terminal_reason: 'retry_exhausted',
        claim_token: null,
        claim_expires_at: null,
        next_attempt_at: null,
      });

      return ok
        ? { status: 'failed', reason: 'retry_exhausted' } satisfies ExecuteDeliveryResult
        : { status: 'stale_claim' } satisfies ExecuteDeliveryResult;
    }

    const claimExpiry = context.claim_expires_at instanceof Date
      ? context.claim_expires_at.getTime()
      : Date.parse(context.claim_expires_at ?? '');
    const deadlineAt = Math.min(
      now.getTime() + NOTIFICATION_PROVIDER_TIMEOUT_MS,
      claimExpiry - NOTIFICATION_PROVIDER_LEASE_SAFETY_MS,
    );
    if (!Number.isFinite(deadlineAt) || remainingBudget(deadlineAt) < NOTIFICATION_PROVIDER_MIN_BUDGET_MS) {
      return requeueForLeaseBudget(trx, params.locator);
    }

    const incremented = await trx('notification_deliveries')
      .where({
        id: params.locator.delivery_id,
        status: 'processing',
        claim_token: params.locator.claim_token,
      })
      .increment('attempt_count', 1)
      .update({
        last_attempt_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning(['attempt_count']);

    if (incremented.length !== 1) return { status: 'stale_claim' } satisfies ExecuteDeliveryResult;
    const content = {
      deliveryId: context.id,
      notificationEventId: context.notification_event_id,
      shopId: context.shop_id,
      userId: context.user_id,
      title: context.title,
      body: context.message,
      action: context.action_json == null ? null : Object.freeze({ ...context.action_json }),
    };
    const delivery: PreparedDelivery = Object.freeze(context.channel === 'push'
      ? { ...content, channel: 'push', destinations }
      : { ...content, channel: 'email', recipient: context.email ?? '' });
    return {
      status: 'prepared',
      delivery,
      deadlineAt,
      previousAttempt: {
        attempt_count: context.attempt_count,
        last_attempt_at: context.last_attempt_at,
      },
      context: {
        ...context,
        channel: context.channel,
        attempt_count: Number(incremented[0].attempt_count),
      },
    };
  });

  if (preflight.status !== 'prepared') return preflight;
  const { context, deadlineAt, previousAttempt } = preflight;
  const budgetMs = remainingBudget(deadlineAt);
  if (budgetMs < NOTIFICATION_PROVIDER_MIN_BUDGET_MS) {
    // A slow commit must not consume an attempt when no provider was called.
    return withTenant(params.locator.shop_id, (trx) =>
      requeueForLeaseBudget(trx, params.locator, previousAttempt),
    );
  }

  let transportResult: DeliveryTransportResult;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('NOTIFICATION_PROVIDER_TIMEOUT'));
  }, budgetMs);

  try {
    transportResult = await params.transport(preflight.delivery, { signal: controller.signal, deadlineAt });
    if (controller.signal.aborted && transportResult.kind !== 'accepted') {
      transportResult = {
        kind: 'retryable_failure', error: 'NOTIFICATION_PROVIDER_TIMEOUT',
        deadDestinations: transportResult.deadDestinations,
      };
    }
  } catch (err) {
    transportResult = {
      kind: 'retryable_failure',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }

  if (context.channel === 'push' && transportResult.deadDestinations?.length) {
    try {
      // A separate transaction isolates cleanup errors from delivery finalization.
      await withTenant(params.locator.shop_id, async (trx) => {
        for (const destination of transportResult.deadDestinations ?? []) {
          await trx('push_subscriptions').where({
            shop_id: context.shop_id,
            user_id: context.user_id,
            id: destination.id,
            device_type: destination.kind,
            updated_at: destination.updatedAt,
            ...(destination.kind === 'web'
              ? { endpoint: destination.endpoint, p256dh: destination.p256dh, auth: destination.auth }
              : { expo_push_token: destination.expoPushToken }),
          }).delete();
        }
      });
    } catch {
      console.warn('[NOTIFICATION_DELIVERY_CLEANUP_FAILED]', { deliveryId: context.id, shopId: context.shop_id });
    }
  }

  return withTenant(params.locator.shop_id, async (trx) => {
    if (transportResult.kind === 'accepted') {
      const ok = await fencedUpdate(trx, params.locator, {
        status: 'sent',
        sent_at: trx.fn.now(),
        provider_message_id: transportResult.providerMessageId ?? null,
        claim_token: null,
        claim_expires_at: null,
        last_error: null,
        next_attempt_at: null,
      });
      return ok ? { status: 'sent' } : { status: 'stale_claim' };
    }

    if (transportResult.kind === 'terminal_failure') {
      const ok = await fencedUpdate(trx, params.locator, {
        status: 'failed',
        failed_at: trx.fn.now(),
        last_error: transportResult.error,
        terminal_reason: transportResult.terminalReason,
        claim_token: null,
        claim_expires_at: null,
      });
      return ok
        ? { status: 'failed', reason: transportResult.terminalReason }
        : { status: 'stale_claim' };
    }

    if (context.attempt_count >= MAX_ATTEMPTS) {
      const ok = await fencedUpdate(trx, params.locator, {
        status: 'failed',
        failed_at: trx.fn.now(),
        last_error: transportResult.error,
        terminal_reason: 'retry_exhausted',
        claim_token: null,
        claim_expires_at: null,
      });
      return ok
        ? { status: 'failed', reason: 'retry_exhausted' }
        : { status: 'stale_claim' };
    }

    const ok = await fencedUpdate(trx, params.locator, {
      status: 'queued',
      last_error: transportResult.error,
      next_attempt_at: retryInstant(context.attempt_count, transportResult, now),
      claim_token: null,
      claim_expires_at: null,
    });
    return ok
      ? { status: 'queued', reason: 'retryable_failure' }
      : { status: 'stale_claim' };
  });
}
