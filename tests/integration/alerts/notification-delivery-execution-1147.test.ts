import crypto from 'crypto';
import db, {
  setTenantContext,
  systemQuery,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  claimNotificationDeliveries,
  executeClaimedNotificationDelivery,
  type DeliveryTransport,
  type NotificationDeliveryLocator,
} from 'api-src/services/notifications/notificationDeliveryExecution.service';
import { createNotificationOccurrenceInTransaction } from 'api-src/services/notifications/notificationOccurrence.service';
import { planNotificationDeliveriesInTransaction } from 'api-src/services/notifications/notificationDeliveryPlanner.service';

type Tenant = {
  shopId: number;
  userId: number;
};

type SeededDelivery = Tenant & {
  eventId: string;
  deliveryId: string;
};

async function seedTenant(options: {
  email?: string | null;
  preferences?: Record<string, unknown>;
  timezone?: string;
} = {}): Promise<Tenant> {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `delivery-execution-${suffix}`);
    await setTenantContext(trx, id);
    await trx('shops')
      .where({ id })
      .update({ timezone: options.timezone ?? 'UTC' });
    return id;
  });

  let userId = 0;
  await withTenant(shopId, async (trx) => {
    const [user] = await trx('users')
      .insert({
        shop_id: shopId,
        email: options.email === undefined
          ? `delivery-execution-${suffix}@example.com`
          : options.email,
        first_name: 'Delivery',
        last_name: 'Execution',
        role: 'owner',
        password_hash: 'test-only',
      })
      .returning(['id']);
    userId = Number(user.id);

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
      notification_preferences: options.preferences === undefined
        ? null
        : JSON.stringify(options.preferences),
    });
  });

  return { shopId, userId };
}

async function seedDelivery(options: {
  channel?: 'push' | 'email';
  status?: string;
  nextAttemptAt?: Date | null;
  claimExpiresAt?: Date | null;
  claimToken?: string | null;
  attemptCount?: number;
  preferences?: Record<string, unknown>;
  email?: string | null;
  timezone?: string;
  readAt?: Date | null;
  clickedAt?: Date | null;
  conditionKey?: string;
  urgency?: 'critical' | 'important' | 'informational';
} = {}): Promise<SeededDelivery> {
  const tenant = await seedTenant({
    email: options.email,
    preferences: options.preferences,
    timezone: options.timezone,
  });

  return withTenant(tenant.shopId, async (trx) => {
    const [event] = await trx('notification_events')
      .insert({
        shop_id: tenant.shopId,
        user_id: tenant.userId,
        condition_key: options.conditionKey ?? 'orders_cannot_be_fulfilled',
        source_type: 'alert',
        source_id: crypto.randomUUID(),
        occurrence_key: `delivery-execution:${crypto.randomUUID()}`,
        source_fingerprint: `fingerprint:${crypto.randomUUID()}`,
        urgency: options.urgency ?? 'critical',
        title: 'Orders cannot be fulfilled',
        message: 'Some orders need attention.',
        read_at: options.readAt ?? null,
        clicked_at: options.clickedAt ?? null,
      })
      .returning(['id']);

    const [delivery] = await trx('notification_deliveries')
      .insert({
        notification_event_id: event.id,
        channel: options.channel ?? 'push',
        status: options.status ?? 'queued',
        attempt_count: options.attemptCount ?? 0,
        next_attempt_at: options.nextAttemptAt === undefined ? null : options.nextAttemptAt,
        claim_token: options.claimToken ?? null,
        claim_expires_at: options.claimExpiresAt ?? null,
      })
      .returning(['id']);

    return {
      ...tenant,
      eventId: String(event.id),
      deliveryId: String(delivery.id),
    };
  });
}

async function seedPushSubscription(shopId: number, userId: number): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('push_subscriptions').insert({
      shop_id: shopId,
      user_id: userId,
      device_type: 'web',
      endpoint: `https://push.example.test/${crypto.randomUUID()}`,
      p256dh: 'p256dh',
      auth: 'auth',
    }),
  );
}

async function deliveryRow(shopId: number, deliveryId: string) {
  return withTenant(shopId, (trx) =>
    trx('notification_deliveries')
      .where({ id: deliveryId })
      .first('*'),
  );
}

async function claimOne(delivery: SeededDelivery, now?: Date): Promise<NotificationDeliveryLocator> {
  const locators = await claimNotificationDeliveries({ limit: 10, leaseSeconds: 60 });
  const locator = locators.find((row) => row.delivery_id === delivery.deliveryId);
  expect(locator).toBeTruthy();
  if (now && locator) {
    // Keep deterministic policy time and the fixture's lease on the same clock.
    await withTenant(delivery.shopId, (trx) =>
      trx('notification_deliveries')
        .where({ id: delivery.deliveryId, claim_token: locator.claim_token })
        .update({ claim_expires_at: new Date(now.getTime() + 60_000) }),
    );
  }
  return locator as NotificationDeliveryLocator;
}

function acceptedTransport(providerMessageId = 'provider-1'): DeliveryTransport {
  return async () => ({ kind: 'accepted', providerMessageId });
}

describe('GH-1147 notification delivery execution', () => {
  it.each([0, 2])('insufficient lease budget requeues without consuming attempt %s', async (attemptCount) => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    const claimToken = crypto.randomUUID();
    const delivery = await seedDelivery({
      status: 'processing',
      claimToken,
      claimExpiresAt: new Date(now.getTime() + 9_000),
      attemptCount,
    });
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const lastAttemptAt = attemptCount ? new Date(now.getTime() - 60_000) : null;
    await withTenant(delivery.shopId, (trx) => trx('notification_deliveries')
      .where({ id: delivery.deliveryId }).update({ last_attempt_at: lastAttemptAt }));
    const transport = jest.fn(acceptedTransport());

    const result = await executeClaimedNotificationDelivery({
      locator: { delivery_id: delivery.deliveryId, shop_id: delivery.shopId, claim_token: claimToken },
      transport,
      now,
    });

    expect(result).toEqual({ status: 'queued', reason: 'lease_budget' });
    expect(transport).not.toHaveBeenCalled();
    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(row).toMatchObject({
      status: 'queued', attempt_count: attemptCount, last_attempt_at: lastAttemptAt,
      claim_token: null, claim_expires_at: null,
    });
    expect(row.next_attempt_at === null || new Date(row.next_attempt_at).getTime() <= now.getTime()).toBe(true);
  });

  it.each([60_000, 15_000])('normal claim passes bounded provider control for a %s ms lease', async (leaseMs) => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    const claimToken = crypto.randomUUID();
    const claimExpiry = now.getTime() + leaseMs;
    const delivery = await seedDelivery({
      status: 'processing', claimToken, claimExpiresAt: new Date(claimExpiry),
    });
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const controls: Array<{ signal: AbortSignal; deadlineAt: number }> = [];
    const transport: DeliveryTransport = async (_delivery, control) => {
      controls.push(control);
      return { kind: 'accepted' };
    };

    const result = await executeClaimedNotificationDelivery({
      locator: { delivery_id: delivery.deliveryId, shop_id: delivery.shopId, claim_token: claimToken },
      transport,
      now,
    });

    expect(result).toEqual({ status: 'sent' });
    expect(controls).toHaveLength(1);
    expect(controls[0]).toBeDefined();
    expect(controls[0].signal).toBeInstanceOf(AbortSignal);
    expect(controls[0].signal.aborted).toBe(false);
    expect(controls[0].deadlineAt).toBeGreaterThanOrEqual(now.getTime() + 5_000);
    expect(controls[0].deadlineAt).toBeLessThanOrEqual(now.getTime() + 20_000);
    expect(controls[0].deadlineAt).toBeLessThanOrEqual(claimExpiry - 5_000);
  });

  it.each([0, 3])('provider deadline abort follows bounded retry semantics from attempt %s', async (attemptCount) => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    const claimToken = crypto.randomUUID();
    const delivery = await seedDelivery({
      status: 'processing', claimToken, attemptCount,
      claimExpiresAt: new Date(now.getTime() + 10_200),
    });
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const signals: AbortSignal[] = [];
    const transport: DeliveryTransport = async (_delivery, control) => {
      signals.push(control.signal);
      await new Promise<void>((_resolve, reject) => {
        const abort = () => {
          const error = new Error('provider request aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (control.signal.aborted) abort();
        else control.signal.addEventListener('abort', abort, { once: true });
      });
      return { kind: 'accepted' };
    };

    const result = await executeClaimedNotificationDelivery({
      locator: { delivery_id: delivery.deliveryId, shop_id: delivery.shopId, claim_token: claimToken },
      transport,
      now,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(result).toEqual(attemptCount === 3
      ? { status: 'failed', reason: 'retry_exhausted' }
      : { status: 'queued', reason: 'retryable_failure' });
    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(row.attempt_count).toBe(attemptCount + 1);
    expect(row.last_attempt_at).not.toBeNull();
    expect(row.claim_token).toBeNull();
    expect(row.claim_expires_at).toBeNull();
    if (attemptCount === 0) {
      expect(new Date(row.next_attempt_at).getTime()).toBe(now.getTime() + 30_000);
    } else {
      expect(row.terminal_reason).toBe('retry_exhausted');
    }
  }, 10_000);

  it.each([0, 4_000])('expired safe lease budget with %s ms remaining never invokes provider', async (remainingMs) => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    const claimToken = crypto.randomUUID();
    const delivery = await seedDelivery({
      status: 'processing', claimToken, claimExpiresAt: new Date(now.getTime() + remainingMs),
    });
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const transport = jest.fn(acceptedTransport());

    const result = await executeClaimedNotificationDelivery({
      locator: { delivery_id: delivery.deliveryId, shop_id: delivery.shopId, claim_token: claimToken },
      transport,
      now,
    });

    expect(transport).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'queued', reason: 'lease_budget' });
    expect(await deliveryRow(delivery.shopId, delivery.deliveryId)).toMatchObject({
      status: 'queued', attempt_count: 0, last_attempt_at: null,
      claim_token: null, claim_expires_at: null,
    });
  });

  it('claims due queued rows and exposes only locator fields', async () => {
    const delivery = await seedDelivery();

    const locator = await claimOne(delivery);
    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);

    expect(Object.keys(locator).sort()).toEqual([
      'claim_token',
      'delivery_id',
      'shop_id',
    ]);
    expect(row.status).toBe('processing');
    expect(row.claim_token).toBe(locator.claim_token);
    expect(row.attempt_count).toBe(0);
    expect(row.last_attempt_at).toBeNull();
  });

  it('does not claim future deliveries', async () => {
    const delivery = await seedDelivery({
      nextAttemptAt: new Date('2099-01-01T00:00:00.000Z'),
    });

    const locators = await claimNotificationDeliveries({ limit: 10, leaseSeconds: 60 });

    expect(locators.some((locator) => locator.delivery_id === delivery.deliveryId)).toBe(false);
  });

  it('prevents concurrent claimers from owning the same delivery', async () => {
    const delivery = await seedDelivery();

    const [first, second] = await Promise.all([
      claimNotificationDeliveries({ limit: 10, leaseSeconds: 60 }),
      claimNotificationDeliveries({ limit: 10, leaseSeconds: 60 }),
    ]);
    const all = [...first, ...second].filter((locator) =>
      locator.delivery_id === delivery.deliveryId,
    );

    expect(all).toHaveLength(1);
  });

  it('reclaims expired processing leases but not live leases and issues a new token', async () => {
    const expiredToken = crypto.randomUUID();
    const live = await seedDelivery({
      status: 'processing',
      claimToken: crypto.randomUUID(),
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    const expired = await seedDelivery({
      status: 'processing',
      claimToken: expiredToken,
      claimExpiresAt: new Date(Date.now() - 60_000),
    });

    const locators = await claimNotificationDeliveries({ limit: 10, leaseSeconds: 60 });

    const reclaimed = locators.find((locator) => locator.delivery_id === expired.deliveryId);
    expect(reclaimed).toBeTruthy();
    expect(reclaimed?.claim_token).not.toBe(expiredToken);
    expect(locators.some((locator) => locator.delivery_id === live.deliveryId)).toBe(false);
  });

  it('stale tokens cannot mark sent, failed, requeued, or cancelled while the current token can update', async () => {
    const delivery = await seedDelivery();
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const locator = await claimOne(delivery);
    const staleLocator = { ...locator, claim_token: crypto.randomUUID() };

    await expect(
      executeClaimedNotificationDelivery({
        locator: staleLocator,
        transport: acceptedTransport('stale'),
      }),
    ).resolves.toEqual({ status: 'not_found' });
    expect((await deliveryRow(delivery.shopId, delivery.deliveryId)).status).toBe('processing');

    await expect(
      executeClaimedNotificationDelivery({
        locator,
        transport: acceptedTransport('current'),
      }),
    ).resolves.toEqual({ status: 'sent' });

    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(row.status).toBe('sent');
    expect(row.provider_message_id).toBe('current');
    expect(row.claim_token).toBeNull();
  });

  it.each([
    ['membership_inactive', async (delivery: SeededDelivery) => {
      await withTenant(delivery.shopId, (trx) =>
        trx('shop_memberships')
          .where({ shop_id: delivery.shopId, user_id: delivery.userId })
          .update({ revoked_at: new Date() }),
      );
    }],
    ['channel_disabled', async (delivery: SeededDelivery) => {
      await withTenant(delivery.shopId, (trx) =>
        trx('shop_memberships')
          .where({ shop_id: delivery.shopId, user_id: delivery.userId })
          .update({
            notification_preferences: JSON.stringify({
              channels: { push: false },
            }),
          }),
      );
    }],
    ['condition_disabled', async (delivery: SeededDelivery) => {
      await withTenant(delivery.shopId, (trx) =>
        trx('shop_memberships')
          .where({ shop_id: delivery.shopId, user_id: delivery.userId })
          .update({
            notification_preferences: JSON.stringify({
              channels: { push: true },
              conditions: {
                orders_cannot_be_fulfilled: { enabled: false },
              },
            }),
          }),
      );
    }],
  ])('cancels with %s before provider execution', async (reason, mutate) => {
    const delivery = await seedDelivery();
    await seedPushSubscription(delivery.shopId, delivery.userId);
    await mutate(delivery);
    const locator = await claimOne(delivery);

    await expect(
      executeClaimedNotificationDelivery({ locator, transport: acceptedTransport() }),
    ).resolves.toEqual({ status: 'cancelled', reason });

    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(row.status).toBe('cancelled');
    expect(row.terminal_reason).toBe(reason);
  });

  it.each(['push', 'email'] as const)(
    'JIT: cancels a %s delivery planned while ON once the global channel is turned OFF, despite condition=true',
    async (channel) => {
      const conditionKey = 'orders_cannot_be_fulfilled';
      const planned = {
        channels: { push: true, email: true },
        conditions: { [conditionKey]: { push: true, email: true } },
      };
      const tenant = await seedTenant({ preferences: planned });
      await seedPushSubscription(tenant.shopId, tenant.userId);

      let eventId = '';
      await withTenant(tenant.shopId, async (trx) => {
        const created = await createNotificationOccurrenceInTransaction(trx, {
          shopId: tenant.shopId,
          userId: tenant.userId,
          conditionKey,
          sourceType: 'alert',
          sourceId: crypto.randomUUID(),
          occurrenceKey: `delivery-execution-jit:${crypto.randomUUID()}`,
          sourceFingerprint: `fingerprint:${crypto.randomUUID()}`,
          title: 'Orders cannot be fulfilled',
          message: 'Some orders need attention.',
          context: { source: 'notification-delivery-execution-1147' },
        });
        expect(created.status).toBe('created');
        if (created.status !== 'created') return;
        eventId = created.notification.id;
        await expect(
          planNotificationDeliveriesInTransaction(trx, created.notification),
        ).resolves.toEqual({ status: 'planned' });
      });

      const plannedRow = await withTenant(tenant.shopId, (trx) =>
        trx('notification_deliveries')
          .where({ notification_event_id: eventId, channel })
          .first('id', 'status'),
      );
      expect(plannedRow).toMatchObject({ status: 'queued' });
      const delivery: SeededDelivery = {
        ...tenant,
        eventId,
        deliveryId: String(plannedRow.id),
      };

      // Merchant turns the global channel OFF after planning; the stored
      // per-condition true is left in place and must not resurrect it.
      await withTenant(tenant.shopId, (trx) =>
        trx('shop_memberships')
          .where({ shop_id: tenant.shopId, user_id: tenant.userId })
          .update({
            notification_preferences: JSON.stringify({
              ...planned,
              channels: { ...planned.channels, [channel]: false },
            }),
          }),
      );

      const locator = await claimOne(delivery);
      const transport = jest.fn(acceptedTransport());

      await expect(
        executeClaimedNotificationDelivery({ locator, transport }),
      ).resolves.toEqual({ status: 'cancelled', reason: 'channel_disabled' });

      expect(transport).not.toHaveBeenCalled();
      const row = await deliveryRow(tenant.shopId, delivery.deliveryId);
      expect(row.status).toBe('cancelled');
      expect(row.terminal_reason).toBe('channel_disabled');
      expect(row.attempt_count).toBe(0);
    },
  );

  it.each([
    ['push', undefined],
    ['email', '   '],
  ] as const)('cancels %s with no_destination', async (channel, email) => {
    const delivery = await seedDelivery({
      channel,
      email,
      preferences: { channels: { [channel]: true } },
    });
    const locator = await claimOne(delivery);

    await expect(
      executeClaimedNotificationDelivery({ locator, transport: acceptedTransport() }),
    ).resolves.toEqual({ status: 'cancelled', reason: 'no_destination' });
  });

  it.each([
    ['read_at', { readAt: new Date() }],
    ['clicked_at', { clickedAt: new Date() }],
  ])('cancels already seen notifications when %s is set', async (_label, option) => {
    const delivery = await seedDelivery(option);
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const locator = await claimOne(delivery);

    await expect(
      executeClaimedNotificationDelivery({ locator, transport: acceptedTransport() }),
    ).resolves.toEqual({ status: 'cancelled', reason: 'already_seen' });
  });

  it('active membership with null notification_preferences uses defaults and remains externally eligible', async () => {
    // seedDelivery() intentionally leaves preferences undefined here.
    // seedTenant() persists that as notification_preferences = NULL,
    // which must mean "active membership using defaults", not
    // "membership missing".
    const delivery = await seedDelivery();
    await seedPushSubscription(delivery.shopId, delivery.userId);

    let providerCalls = 0;
    const transport: DeliveryTransport = async () => {
      providerCalls += 1;
      return {
        kind: 'accepted',
        providerMessageId: 'null-preferences-defaults',
      };
    };

    const locator = await claimOne(delivery);

    await expect(
      executeClaimedNotificationDelivery({ locator, transport }),
    ).resolves.toEqual({ status: 'sent' });

    expect(providerCalls).toBe(1);

    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(row.status).toBe('sent');
    expect(row.provider_message_id).toBe('null-preferences-defaults');
    expect(row.attempt_count).toBe(1);
    expect(row.terminal_reason).toBeNull();
    expect(row.cancelled_at).toBeNull();
  });

  it('executes when quiet hours are disabled', async () => {
    const delivery = await seedDelivery({
      preferences: { quiet_hours: { enabled: false }, channels: { push: true } },
    });
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const locator = await claimOne(delivery, new Date('2026-09-22T23:00:00.000Z'));

    await expect(
      executeClaimedNotificationDelivery({
        locator,
        transport: acceptedTransport(),
        now: new Date('2026-09-22T23:00:00.000Z'),
      }),
    ).resolves.toEqual({ status: 'sent' });
  });

  it.each([
    [
      'overnight 22:00-07:00 defers at 23:00',
      'UTC',
      new Date('2026-09-22T23:00:00.000Z'),
      { start: '22:00', end: '07:00', allow_critical: false },
      '2026-09-23T07:00:00.000Z',
    ],
    [
      'same-day 09:00-17:00 defers at 10:00',
      'UTC',
      new Date('2026-09-22T10:00:00.000Z'),
      { start: '09:00', end: '17:00', allow_critical: false },
      '2026-09-22T17:00:00.000Z',
    ],
    [
      'Stockholm timezone differs from UTC',
      'Europe/Stockholm',
      new Date('2026-09-22T20:30:00.000Z'),
      { start: '22:00', end: '07:00', allow_critical: false },
      '2026-09-23T05:00:00.000Z',
    ],
    [
      'DST spring boundary is deterministic',
      'America/New_York',
      new Date('2026-03-08T06:30:00.000Z'),
      { start: '01:00', end: '03:00', allow_critical: false },
      '2026-03-08T07:00:00.000Z',
    ],
    [
      'DST spring skipped quiet-end advances to first real eligible minute',
      'America/New_York',
      new Date('2026-03-08T06:30:00.000Z'),
      { start: '00:00', end: '02:30', allow_critical: false },
      '2026-03-08T07:00:00.000Z',
    ],
    [
      'DST fall repeated hour never schedules the first occurrence in the past',
      'America/New_York',
      new Date('2026-11-01T06:00:00.000Z'),
      { start: '00:00', end: '01:30', allow_critical: false },
      '2026-11-01T06:30:00.000Z',
    ],
    [
      'invalid shop timezone falls back to UTC',
      'Not/A_Real_Timezone',
      new Date('2026-09-22T23:00:00.000Z'),
      { start: '22:00', end: '07:00', allow_critical: false },
      '2026-09-23T07:00:00.000Z',
    ],
  ])('%s', async (_label, timezone, now, quiet, expectedNextAttempt) => {
    const delivery = await seedDelivery({
      timezone,
      preferences: {
        channels: { push: true },
        quiet_hours: { enabled: true, ...quiet },
      },
    });
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const locator = await claimOne(delivery, now);

    await expect(
      executeClaimedNotificationDelivery({ locator, transport: acceptedTransport(), now }),
    ).resolves.toEqual({ status: 'queued', reason: 'quiet_hours' });

    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(new Date(row.next_attempt_at).toISOString()).toBe(expectedNextAttempt);
    expect(row.attempt_count).toBe(0);
    expect(row.last_attempt_at).toBeNull();
  });

  it('allows exact quiet-hours end boundary and critical allow_critical=true bypass', async () => {
    const boundary = await seedDelivery({
      preferences: {
        channels: { push: true },
        quiet_hours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          allow_critical: false,
        },
      },
    });
    await seedPushSubscription(boundary.shopId, boundary.userId);
    await expect(
      executeClaimedNotificationDelivery({
        locator: await claimOne(boundary, new Date('2026-09-23T07:00:00.000Z')),
        transport: acceptedTransport(),
        now: new Date('2026-09-23T07:00:00.000Z'),
      }),
    ).resolves.toEqual({ status: 'sent' });

    const bypass = await seedDelivery({
      preferences: {
        channels: { push: true },
        quiet_hours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          allow_critical: true,
        },
      },
    });
    await seedPushSubscription(bypass.shopId, bypass.userId);
    await expect(
      executeClaimedNotificationDelivery({
        locator: await claimOne(bypass, new Date('2026-09-22T23:00:00.000Z')),
        transport: acceptedTransport(),
        now: new Date('2026-09-22T23:00:00.000Z'),
      }),
    ).resolves.toEqual({ status: 'sent' });
  });

  it('increments attempt_count only for provider invocation and records accepted/retryable/terminal outcomes', async () => {
    const accepted = await seedDelivery();
    await seedPushSubscription(accepted.shopId, accepted.userId);
    await executeClaimedNotificationDelivery({
      locator: await claimOne(accepted),
      transport: acceptedTransport('accepted-id'),
    });
    expect(await deliveryRow(accepted.shopId, accepted.deliveryId)).toMatchObject({
      status: 'sent',
      attempt_count: 1,
      provider_message_id: 'accepted-id',
    });

    const retryable = await seedDelivery();
    await seedPushSubscription(retryable.shopId, retryable.userId);
    await executeClaimedNotificationDelivery({
      locator: await claimOne(retryable, new Date('2026-09-22T12:00:00.000Z')),
      transport: async () => ({
        kind: 'retryable_failure',
        error: 'temporary',
        retryAfterMs: 45_000,
      }),
      now: new Date('2026-09-22T12:00:00.000Z'),
    });
    const retryableRow = await deliveryRow(retryable.shopId, retryable.deliveryId);
    expect(retryableRow.status).toBe('queued');
    expect(retryableRow.attempt_count).toBe(1);
    expect(new Date(retryableRow.next_attempt_at).toISOString()).toBe('2026-09-22T12:00:45.000Z');

    const terminal = await seedDelivery();
    await seedPushSubscription(terminal.shopId, terminal.userId);
    await executeClaimedNotificationDelivery({
      locator: await claimOne(terminal),
      transport: async () => ({
        kind: 'terminal_failure',
        error: 'bad destination',
        terminalReason: 'provider_rejected',
      }),
    });
    expect(await deliveryRow(terminal.shopId, terminal.deliveryId)).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      last_error: 'bad destination',
      terminal_reason: 'provider_rejected',
    });
  });

  it('treats thrown transport errors as bounded retryable failures', async () => {
    const delivery = await seedDelivery();
    await seedPushSubscription(delivery.shopId, delivery.userId);

    let providerCalls = 0;
    const throwingTransport: DeliveryTransport = async () => {
      providerCalls += 1;
      throw new Error('temporary provider outage');
    };

    const locator = await claimOne(delivery, new Date('2026-09-22T12:00:00.000Z'));

    await expect(
      executeClaimedNotificationDelivery({
        locator,
        transport: throwingTransport,
        now: new Date('2026-09-22T12:00:00.000Z'),
      }),
    ).resolves.toEqual({
      status: 'queued',
      reason: 'retryable_failure',
    });

    expect(providerCalls).toBe(1);

    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(row.status).toBe('queued');
    expect(row.attempt_count).toBe(1);
    expect(row.last_error).toBe('temporary provider outage');
    expect(row.next_attempt_at).not.toBeNull();
    expect(row.claim_token).toBeNull();
    expect(row.claim_expires_at).toBeNull();
  });

  it('does not invoke provider when a reclaimed delivery already exhausted four attempts', async () => {
    const originalToken = crypto.randomUUID();

    const delivery = await seedDelivery({
      status: 'processing',
      attemptCount: 4,
      claimToken: originalToken,
      claimExpiresAt: new Date(Date.now() - 60_000),
    });

    await seedPushSubscription(delivery.shopId, delivery.userId);

    let providerCalls = 0;
    const transport: DeliveryTransport = async () => {
      providerCalls += 1;
      return { kind: 'accepted', providerMessageId: 'must-not-send' };
    };

    const locator = await claimOne(delivery);
    expect(locator.claim_token).not.toBe(originalToken);

    await expect(
      executeClaimedNotificationDelivery({ locator, transport }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'retry_exhausted',
    });

    expect(providerCalls).toBe(0);

    const row = await deliveryRow(delivery.shopId, delivery.deliveryId);
    expect(row.status).toBe('failed');
    expect(row.attempt_count).toBe(4);
    expect(row.terminal_reason).toBe('retry_exhausted');
    expect(row.failed_at).not.toBeNull();
    expect(row.next_attempt_at).toBeNull();
    expect(row.claim_token).toBeNull();
    expect(row.claim_expires_at).toBeNull();
  });

  it('fails fourth retryable attempt with retry_exhausted and uses fallback retry schedule otherwise', async () => {
    const retry = await seedDelivery({ attemptCount: 1 });
    await seedPushSubscription(retry.shopId, retry.userId);
    await executeClaimedNotificationDelivery({
      locator: await claimOne(retry, new Date('2026-09-22T12:00:00.000Z')),
      transport: async () => ({ kind: 'retryable_failure', error: 'temporary' }),
      now: new Date('2026-09-22T12:00:00.000Z'),
    });
    expect(new Date((await deliveryRow(retry.shopId, retry.deliveryId)).next_attempt_at).toISOString())
      .toBe('2026-09-22T12:02:00.000Z');

    const exhausted = await seedDelivery({ attemptCount: 3 });
    await seedPushSubscription(exhausted.shopId, exhausted.userId);
    await executeClaimedNotificationDelivery({
      locator: await claimOne(exhausted),
      transport: async () => ({ kind: 'retryable_failure', error: 'still down' }),
    });
    expect(await deliveryRow(exhausted.shopId, exhausted.deliveryId)).toMatchObject({
      status: 'failed',
      attempt_count: 4,
      terminal_reason: 'retry_exhausted',
    });
  });

  it('does not let stale first worker overwrite a reclaimed worker result', async () => {
    const delivery = await seedDelivery();
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const first = await claimOne(delivery);
    await withTenant(delivery.shopId, (trx) =>
      trx('notification_deliveries')
        .where({ id: delivery.deliveryId })
        .update({ claim_expires_at: new Date(Date.now() - 60_000) }),
    );
    const second = await claimOne(delivery);

    await expect(
      executeClaimedNotificationDelivery({
        locator: second,
        transport: acceptedTransport('second'),
      }),
    ).resolves.toEqual({ status: 'sent' });
    await expect(
      executeClaimedNotificationDelivery({
        locator: first,
        transport: async () => ({
          kind: 'terminal_failure',
          error: 'first',
          terminalReason: 'stale',
        }),
      }),
    ).resolves.toEqual({ status: 'not_found' });

    expect(await deliveryRow(delivery.shopId, delivery.deliveryId)).toMatchObject({
      status: 'sent',
      provider_message_id: 'second',
    });
  });

  it('normal racing workers claim one locator and invoke transport once', async () => {
    const delivery = await seedDelivery();
    await seedPushSubscription(delivery.shopId, delivery.userId);
    let transportCalls = 0;

    const [a, b] = await Promise.all([
      claimNotificationDeliveries({ limit: 1, leaseSeconds: 60 }),
      claimNotificationDeliveries({ limit: 1, leaseSeconds: 60 }),
    ]);
    const locators = [...a, ...b].filter((locator) =>
      locator.delivery_id === delivery.deliveryId,
    );

    await Promise.all(locators.map((locator) =>
      executeClaimedNotificationDelivery({
        locator,
        transport: async () => {
          transportCalls += 1;
          return { kind: 'accepted' };
        },
      }),
    ));

    expect(locators).toHaveLength(1);
    expect(transportCalls).toBe(1);
  });

  it('calls provider after durable processing attempt state is committed', async () => {
    const delivery = await seedDelivery();
    await seedPushSubscription(delivery.shopId, delivery.userId);
    const locator = await claimOne(delivery);
    let observed: any = null;

    await executeClaimedNotificationDelivery({
      locator,
      transport: async () => {
        observed = await deliveryRow(delivery.shopId, delivery.deliveryId);
        return { kind: 'accepted' };
      },
    });

    expect(observed).toMatchObject({
      status: 'processing',
      attempt_count: 1,
      claim_token: locator.claim_token,
    });
    expect(observed.last_attempt_at).toBeTruthy();
  });

  it('tenant-scoped refetch rejects cross-tenant mutation', async () => {
    const tenantA = await seedDelivery();
    const tenantB = await seedDelivery();
    await seedPushSubscription(tenantA.shopId, tenantA.userId);
    const locator = await claimOne(tenantA);

    await expect(
      executeClaimedNotificationDelivery({
        locator: { ...locator, shop_id: tenantB.shopId },
        transport: acceptedTransport('wrong-tenant'),
      }),
    ).resolves.toEqual({ status: 'not_found' });

    expect((await deliveryRow(tenantA.shopId, tenantA.deliveryId)).status).toBe('processing');
  });

  it('claim function is executable through runtime role but direct cross-tenant table mutation is rejected', async () => {
    const delivery = await seedDelivery();
    const other = await seedTenant();

    const locator = await claimOne(delivery);
    expect(locator.delivery_id).toBe(delivery.deliveryId);

    const mutated = await withTenant(other.shopId, async (trx) =>
      trx('notification_deliveries')
        .where({ id: delivery.deliveryId })
        .update({ status: 'sent' }),
    );

    expect(mutated).toBe(0);
    expect((await deliveryRow(delivery.shopId, delivery.deliveryId)).status).toBe('processing');
  });
});
