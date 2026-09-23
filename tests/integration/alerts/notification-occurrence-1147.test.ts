import crypto from 'crypto';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { createNotificationOccurrence } from 'api-src/services/notifications/notificationOccurrence.service';

async function seedTenant(): Promise<{ shopId: number; userId: number }> {
  const label = crypto.randomBytes(6).toString('hex');
  const created = await systemQuery(
    db.raw('SELECT public.create_tenant_shop(?) AS id', [
      `GH-1147 occurrence ${label}`,
    ]),
  );

  const shopId = Number(created.rows?.[0]?.id);
  expect(shopId).toBeGreaterThan(0);

  let userId = 0;

  await withTenant(shopId, async (trx) => {
    const [user] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `occurrence-${label}@example.com`,
        first_name: 'Occurrence',
        last_name: 'User',
        role: 'owner',
        password_hash: 'test-only',
      })
      .returning(['id']);

    userId = Number(user.id);

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
    });
  });

  expect(userId).toBeGreaterThan(0);

  return { shopId, userId };
}

function candidate(overrides: Partial<Parameters<typeof createNotificationOccurrence>[0]> = {}) {
  return {
    shopId: overrides.shopId ?? 0,
    userId: overrides.userId ?? 0,
    conditionKey: overrides.conditionKey ?? 'orders_cannot_be_fulfilled',
    sourceType: overrides.sourceType ?? 'order_constraint',
    sourceId: overrides.sourceId ?? crypto.randomUUID(),
    occurrenceKey: overrides.occurrenceKey ?? `occurrence:${crypto.randomUUID()}`,
    sourceFingerprint: overrides.sourceFingerprint ?? `fingerprint:${crypto.randomUUID()}`,
    title: overrides.title ?? 'Orders cannot be fulfilled',
    message: overrides.message ?? 'Some orders need attention.',
    context: overrides.context ?? { order_count: 2 },
  };
}

async function eventRows(shopId: number, userId: number) {
  return withTenant(shopId, (trx) =>
    trx('notification_events')
      .where({ shop_id: shopId, user_id: userId })
      .orderBy('created_at', 'asc'),
  );
}

describe('GH-1147 — notification occurrence service', () => {
  it('creates exactly one eligible notification event from a candidate', async () => {
    const tenant = await seedTenant();

    const result = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        context: { constraint_count: 3 },
      }),
    );

    expect(result.status).toBe('created');

    const rows = await eventRows(tenant.shopId, tenant.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        shop_id: tenant.shopId,
        user_id: tenant.userId,
        condition_key: 'orders_cannot_be_fulfilled',
        urgency: 'critical',
        title: 'Orders cannot be fulfilled',
        message: 'Some orders need attention.',
      }),
    );
    expect(rows[0].context_json).toEqual({ constraint_count: 3 });
  });

  it('persists urgency and action from the registry, not caller-shaped input', async () => {
    const tenant = await seedTenant();

    const result = await createNotificationOccurrence({
      ...candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        conditionKey: 'not_enough_stock_to_fulfill_orders',
      }),
      ...( {
        urgency: 'critical',
        action: { route: '/wrong', label: 'Wrong' },
      } as any),
    });

    expect(result.status).toBe('created');

    const rows = await eventRows(tenant.shopId, tenant.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].urgency).toBe('important');
    expect(rows[0].action_json).toEqual({
      route: '/orders/flow?constraint=inventory',
      label: 'Resolve stockouts',
    });
  });

  it('does not create notification delivery rows', async () => {
    const tenant = await seedTenant();

    await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
      }),
    );

    await withTenant(tenant.shopId, async (trx) => {
      const events = await trx('notification_events')
        .where({ shop_id: tenant.shopId, user_id: tenant.userId });
      const deliveries = await trx('notification_deliveries')
        .whereIn('notification_event_id', events.map((event) => event.id));

      expect(events).toHaveLength(1);
      expect(deliveries).toHaveLength(0);
    });
  });

  it('suppresses noncritical disabled conditions and critical-only important conditions', async () => {
    const disabled = await seedTenant();
    const criticalOnly = await seedTenant();

    await withTenant(disabled.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: disabled.shopId, user_id: disabled.userId })
        .update({
          notification_preferences: JSON.stringify({
            conditions: {
              not_enough_stock_to_fulfill_orders: {
                enabled: false,
              },
            },
          }),
        }),
    );

    await withTenant(criticalOnly.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: criticalOnly.shopId, user_id: criticalOnly.userId })
        .update({
          notification_preferences: JSON.stringify({
            urgency: 'critical_only',
          }),
        }),
    );

    const disabledResult = await createNotificationOccurrence(
      candidate({
        shopId: disabled.shopId,
        userId: disabled.userId,
        conditionKey: 'not_enough_stock_to_fulfill_orders',
      }),
    );
    const criticalOnlyResult = await createNotificationOccurrence(
      candidate({
        shopId: criticalOnly.shopId,
        userId: criticalOnly.userId,
        conditionKey: 'not_enough_stock_to_fulfill_orders',
      }),
    );

    expect(disabledResult).toEqual({
      status: 'suppressed',
      reason: 'condition_disabled',
    });
    expect(criticalOnlyResult).toEqual({
      status: 'suppressed',
      reason: 'urgency_filtered',
    });
    expect(await eventRows(disabled.shopId, disabled.userId)).toHaveLength(0);
    expect(await eventRows(criticalOnly.shopId, criticalOnly.userId)).toHaveLength(0);
  });

  it('creates critical protected events even when the condition is disabled', async () => {
    const tenant = await seedTenant();

    await withTenant(tenant.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: tenant.shopId, user_id: tenant.userId })
        .update({
          notification_preferences: JSON.stringify({
            conditions: {
              orders_cannot_be_fulfilled: {
                enabled: false,
              },
            },
          }),
        }),
    );

    const result = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        conditionKey: 'orders_cannot_be_fulfilled',
      }),
    );

    expect(result.status).toBe('created');
    expect(await eventRows(tenant.shopId, tenant.userId)).toHaveLength(1);
  });

  it('suppresses revoked memberships and unknown conditions', async () => {
    const revoked = await seedTenant();
    const unknown = await seedTenant();

    await withTenant(revoked.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: revoked.shopId, user_id: revoked.userId })
        .update({ revoked_at: new Date() }),
    );

    const revokedResult = await createNotificationOccurrence(
      candidate({
        shopId: revoked.shopId,
        userId: revoked.userId,
      }),
    );
    const unknownResult = await createNotificationOccurrence(
      candidate({
        shopId: unknown.shopId,
        userId: unknown.userId,
        conditionKey: 'delivery_overdue',
      }),
    );

    expect(revokedResult).toEqual({
      status: 'suppressed',
      reason: 'inactive_membership',
    });
    expect(unknownResult).toEqual({
      status: 'suppressed',
      reason: 'unknown_condition',
    });
    expect(await eventRows(revoked.shopId, revoked.userId)).toHaveLength(0);
    expect(await eventRows(unknown.shopId, unknown.userId)).toHaveLength(0);
  });

  it('deduplicates repeated calls with the same occurrence key and fingerprint', async () => {
    const tenant = await seedTenant();
    const occurrenceKey = `dedupe:${crypto.randomUUID()}`;
    const sourceFingerprint = 'orders=2';

    const first = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        occurrenceKey,
        sourceFingerprint,
      }),
    );
    const second = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        occurrenceKey,
        sourceFingerprint,
      }),
    );

    expect(first.status).toBe('created');
    expect(second.status).toBe('duplicate');
    expect(await eventRows(tenant.shopId, tenant.userId)).toHaveLength(1);
  });

  it('is concurrency safe for the same occurrence key and fingerprint', async () => {
    const tenant = await seedTenant();
    const occurrenceKey = `concurrent:${crypto.randomUUID()}`;
    const sourceFingerprint = 'orders=concurrent';

    const results = await Promise.all([
      createNotificationOccurrence(
        candidate({
          shopId: tenant.shopId,
          userId: tenant.userId,
          occurrenceKey,
          sourceFingerprint,
        }),
      ),
      createNotificationOccurrence(
        candidate({
          shopId: tenant.shopId,
          userId: tenant.userId,
          occurrenceKey,
          sourceFingerprint,
        }),
      ),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'created',
      'duplicate',
    ]);
    expect(await eventRows(tenant.shopId, tenant.userId)).toHaveLength(1);
  });

  it('is concurrency safe for the same occurrence key with changed fingerprints', async () => {
    const tenant = await seedTenant();
    const occurrenceKey = `concurrent-conflict:${crypto.randomUUID()}`;
    const firstCandidate = candidate({
      shopId: tenant.shopId,
      userId: tenant.userId,
      occurrenceKey,
      sourceFingerprint: 'orders=concurrent-a',
      title: 'Concurrent title A',
      message: 'Concurrent message A',
      context: { winner: 'a' },
    });
    const secondCandidate = candidate({
      shopId: tenant.shopId,
      userId: tenant.userId,
      occurrenceKey,
      sourceFingerprint: 'orders=concurrent-b',
      title: 'Concurrent title B',
      message: 'Concurrent message B',
      context: { winner: 'b' },
    });

    const results = await Promise.all([
      createNotificationOccurrence(firstCandidate),
      createNotificationOccurrence(secondCandidate),
    ]);

    expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'conflict')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(0);

    const rows = await eventRows(tenant.shopId, tenant.userId);
    expect(rows).toHaveLength(1);
    expect([
      firstCandidate.sourceFingerprint,
      secondCandidate.sourceFingerprint,
    ]).toContain(rows[0].source_fingerprint);

    if (rows[0].source_fingerprint === firstCandidate.sourceFingerprint) {
      expect(rows[0]).toEqual(
        expect.objectContaining({
          title: firstCandidate.title,
          message: firstCandidate.message,
          context_json: firstCandidate.context,
        }),
      );
    } else {
      expect(rows[0]).toEqual(
        expect.objectContaining({
          title: secondCandidate.title,
          message: secondCandidate.message,
          context_json: secondCandidate.context,
        }),
      );
    }
  });

  it('deduplicates same fingerprints without mutating original presentation data', async () => {
    const tenant = await seedTenant();
    const occurrenceKey = `presentation:${crypto.randomUUID()}`;
    const sourceFingerprint = 'orders=presentation';

    const first = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        occurrenceKey,
        sourceFingerprint,
        title: 'Original presentation title',
        message: 'Original presentation message',
        context: { version: 'original' },
      }),
    );
    const second = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        occurrenceKey,
        sourceFingerprint,
        title: 'Changed presentation title',
        message: 'Changed presentation message',
        context: { version: 'changed' },
      }),
    );

    expect(first.status).toBe('created');
    expect(second.status).toBe('duplicate');

    const rows = await eventRows(tenant.shopId, tenant.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        source_fingerprint: sourceFingerprint,
        title: 'Original presentation title',
        message: 'Original presentation message',
        context_json: { version: 'original' },
      }),
    );
  });

  it('reports changed source fingerprint conflicts without mutating the original event', async () => {
    const tenant = await seedTenant();
    const occurrenceKey = `fingerprint:${crypto.randomUUID()}`;

    const first = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        occurrenceKey,
        sourceFingerprint: 'orders=1',
        title: 'Original title',
        message: 'Original message',
      }),
    );
    const conflict = await createNotificationOccurrence(
      candidate({
        shopId: tenant.shopId,
        userId: tenant.userId,
        occurrenceKey,
        sourceFingerprint: 'orders=2',
        title: 'Changed title',
        message: 'Changed message',
      }),
    );

    expect(first.status).toBe('created');
    expect(conflict).toEqual(
      expect.objectContaining({
        status: 'conflict',
        reason: 'source_fingerprint_changed',
      }),
    );

    const rows = await eventRows(tenant.shopId, tenant.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        source_fingerprint: 'orders=1',
        title: 'Original title',
        message: 'Original message',
      }),
    );
  });

  it('preserves tenant and user isolation', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();

    const eventB = await createNotificationOccurrence(
      candidate({
        shopId: tenantB.shopId,
        userId: tenantB.userId,
        title: 'Tenant B event',
      }),
    );
    const mismatchedUser = await createNotificationOccurrence(
      candidate({
        shopId: tenantA.shopId,
        userId: tenantB.userId,
        title: 'Mismatched user',
      }),
    );

    expect(eventB.status).toBe('created');
    expect(mismatchedUser).toEqual({
      status: 'suppressed',
      reason: 'inactive_membership',
    });

    await withTenant(tenantA.shopId, async (trx) => {
      const rows = await trx('notification_events')
        .where({ id: eventB.status === 'created' ? eventB.notification.id : '' });
      expect(rows).toHaveLength(0);
    });
  });
});
