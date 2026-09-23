import crypto from 'node:crypto';
import db, { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  executeClaimedNotificationDelivery,
  type PreparedDelivery,
  type DeliveryTransport,
} from 'api-src/services/notifications/notificationDeliveryExecution.service';
import { createNotificationDeliveryTransport } from 'api-src/services/notifications/notificationDeliveryTransport.service';

async function fixture(channel: 'push' | 'email' = 'push') {
  const suffix = crypto.randomUUID();
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `transport-${suffix}`);
    await setTenantContext(trx, id);
    await trx('shops').where({ id }).update({ timezone: 'UTC' });
    return id;
  });
  return withTenant(shopId, async (trx) => {
    const [user] = await trx('users').insert({
      shop_id: shopId, email: `${suffix}@example.com`, first_name: 'Transport',
      last_name: 'Test', role: 'owner', password_hash: 'test-only',
    }).returning('id');
    const userId = Number(user.id);
    await trx('shop_memberships').insert({
      shop_id: shopId, user_id: userId, role: 'owner',
      notification_preferences: JSON.stringify({ channels: { push: true, email: true } }),
    });
    const action = { route: '/orders', label: 'Open orders' };
    const [event] = await trx('notification_events').insert({
      shop_id: shopId, user_id: userId, condition_key: 'orders_cannot_be_fulfilled',
      source_type: 'alert', source_id: suffix, occurrence_key: suffix,
      source_fingerprint: suffix, urgency: 'critical', title: 'Persisted title',
      message: 'Persisted message', action_json: JSON.stringify(action),
    }).returning('id');
    const claimToken = crypto.randomUUID();
    const [delivery] = await trx('notification_deliveries').insert({
      notification_event_id: event.id, channel, status: 'processing',
      claim_token: claimToken, claim_expires_at: new Date(Date.now() + 60_000),
    }).returning('id');
    const subscriptions = await trx('push_subscriptions').insert([
      { shop_id: shopId, user_id: userId, device_type: 'web', endpoint: `https://push.example.com/${suffix}`, p256dh: 'key', auth: 'auth' },
      { shop_id: shopId, user_id: userId, device_type: 'expo', expo_push_token: `ExponentPushToken[${suffix}]` },
    ]).returning('*');
    return {
      shopId, userId, eventId: String(event.id), deliveryId: String(delivery.id), action, subscriptions,
      locator: { delivery_id: String(delivery.id), shop_id: shopId, claim_token: claimToken },
    };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function row(f: Fixture) {
  return withTenant(f.shopId, (trx) => trx('notification_deliveries').where({ id: f.deliveryId }).first('*'));
}
async function subscriptions(f: Fixture) {
  return withTenant(f.shopId, (trx) => trx('push_subscriptions').where({ shop_id: f.shopId, user_id: f.userId }));
}

describe('GH-1147 prepared delivery and safe cleanup', () => {
  it('prepares immutable persisted push content and current Web/Expo destinations', async () => {
    const f = await fixture();
    await withTenant(f.shopId, (trx) => trx('push_subscriptions')
      .where({ id: f.subscriptions[0].id }).update({ p256dh: 'current-key' }));
    const transport: DeliveryTransport = async (delivery) => {
      expect(delivery).toMatchObject({
        channel: 'push', title: 'Persisted title', body: 'Persisted message',
        action: f.action, userId: f.userId, shopId: f.shopId, notificationEventId: f.eventId,
      });
      if (delivery.channel !== 'push') throw new Error('Expected push');
      expect(delivery.destinations).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'web', id: f.subscriptions[0].id, p256dh: 'current-key', auth: 'auth' }),
        expect.objectContaining({ kind: 'expo', id: f.subscriptions[1].id, expoPushToken: f.subscriptions[1].expo_push_token }),
      ]));
      expect(delivery.destinations).toHaveLength(2);
      expect(Object.isFrozen(delivery)).toBe(true);
      expect(Object.isFrozen(delivery.action)).toBe(true);
      expect(Object.isFrozen(delivery.destinations)).toBe(true);
      expect(delivery.destinations.every(Object.isFrozen)).toBe(true);
      expect((await row(f)).attempt_count).toBe(1);
      return { kind: 'accepted' };
    };
    expect(await executeClaimedNotificationDelivery({ locator: f.locator, transport })).toEqual({ status: 'sent' });
  });
  it('prepares current email recipient, stores acceptance ID, and leaves delivered_at null', async () => {
    const f = await fixture('email');
    await withTenant(f.shopId, (trx) => trx('users').where({ id: f.userId }).update({ email: 'current@example.com' }));
    const transport: DeliveryTransport = async (delivery) => {
      expect(delivery).toMatchObject({ channel: 'email', recipient: 'current@example.com', title: 'Persisted title', body: 'Persisted message', action: f.action });
      return { kind: 'accepted', providerMessageId: 'resend-id' };
    };
    expect(await executeClaimedNotificationDelivery({ locator: f.locator, transport })).toEqual({ status: 'sent' });
    expect(await row(f)).toMatchObject({ status: 'sent', provider_message_id: 'resend-id', delivered_at: null, sent_at: expect.any(Date) });
  });
  it.each(['web', 'expo'])('compare-deletes confirmed dead %s subscription', async (kind) => {
    const f = await fixture();
    await executeClaimedNotificationDelivery({ locator: f.locator, transport: async (delivery) => {
      if (delivery.channel !== 'push') throw new Error('Expected push');
      return { kind: 'terminal_failure', error: 'dead', terminalReason: 'provider_rejected', deadDestinations: delivery.destinations.filter((d) => d.kind === kind) };
    } });
    const remaining = await subscriptions(f);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].device_type).not.toBe(kind);
  });
  it.each(['web', 'expo'])('preserves refreshed %s destination against old dead result', async (kind) => {
    const f = await fixture();
    await executeClaimedNotificationDelivery({ locator: f.locator, transport: async (delivery) => {
      if (delivery.channel !== 'push') throw new Error('Expected push');
      const dead = delivery.destinations.filter((d) => d.kind === kind);
      await withTenant(f.shopId, (trx) => trx('push_subscriptions').where({ id: dead[0].id })
        .update(kind === 'web' ? { p256dh: 'refreshed-key', updated_at: trx.fn.now() } : { expo_push_token: 'ExponentPushToken[replacement]', updated_at: trx.fn.now() }));
      return { kind: 'terminal_failure', error: 'dead', terminalReason: 'provider_rejected', deadDestinations: dead };
    } });
    expect(await subscriptions(f)).toHaveLength(2);
  });
  it('partial push acceptance finalizes sent with null aggregate ID and no delivered timestamp', async () => {
    const f = await fixture();
    const transport = createNotificationDeliveryTransport({
      config: { VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_MAILTO: 'mailto:ops@example.com' },
      generateWebRequest: () => ({ endpoint: 'https://push.example.com', method: 'POST', headers: {}, body: Buffer.from('encrypted') }),
      http: async (request) => request.url.includes('exp.host')
        ? { status: 200, headers: {}, body: JSON.stringify({ data: [{ status: 'ok', id: 'ticket' }] }) }
        : { status: 410, headers: {}, body: '' },
    });
    expect(await executeClaimedNotificationDelivery({ locator: f.locator, transport })).toEqual({ status: 'sent' });
    expect(await row(f)).toMatchObject({ status: 'sent', provider_message_id: null, delivered_at: null, sent_at: expect.any(Date) });
    expect(await subscriptions(f)).toHaveLength(1);
  });
  it('provider invocation performs no independent tenant queries', async () => {
    const f = await fixture('email');
    let prepared: PreparedDelivery | undefined;
    await executeClaimedNotificationDelivery({ locator: f.locator, transport: async (delivery) => {
      prepared = delivery;
      return { kind: 'accepted' };
    } });
    if (!prepared) throw new Error('No prepared payload');
    const queries: string[] = [];
    const listener = (query: { sql: string }) => queries.push(query.sql);
    db.on('query', listener);
    try {
      const transport = createNotificationDeliveryTransport({
        config: { RESEND_API_KEY: 'test-key' },
        http: async () => ({ status: 200, headers: {}, body: '{"id":"email-id"}' }),
      });
      expect(await transport(prepared, { signal: new AbortController().signal, deadlineAt: Date.now() + 20_000 })).toMatchObject({ kind: 'accepted' });
      expect(queries).toEqual([]);
    } finally {
      db.removeListener('query', listener);
    }
  });
  it('cleanup failure cannot erase accepted classification', async () => {
    const f = await fixture();
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await executeClaimedNotificationDelivery({ locator: f.locator, transport: async (delivery) => {
        if (delivery.channel !== 'push') throw new Error('Expected push');
        return { kind: 'accepted', deadDestinations: [{ ...delivery.destinations[0], updatedAt: 'invalid-timestamp' }] };
      } })).toEqual({ status: 'sent' });
      expect(warning).toHaveBeenCalled();
      expect(await row(f)).toMatchObject({ status: 'sent', delivered_at: null });
    } finally {
      warning.mockRestore();
    }
  });
  it.each(['membership', 'lease'])('does not invoke provider after %s rejection', async (reason) => {
    const f = await fixture();
    await withTenant(f.shopId, (trx) => reason === 'membership'
      ? trx('shop_memberships').where({ shop_id: f.shopId, user_id: f.userId }).update({ revoked_at: trx.fn.now() })
      : trx('notification_deliveries').where({ id: f.deliveryId }).update({ claim_expires_at: new Date(Date.now() + 2_000) }));
    const transport = jest.fn<ReturnType<DeliveryTransport>, Parameters<DeliveryTransport>>();
    expect(await executeClaimedNotificationDelivery({ locator: f.locator, transport })).toMatchObject({ status: reason === 'membership' ? 'cancelled' : 'queued' });
    expect(transport).not.toHaveBeenCalled();
  });
});
