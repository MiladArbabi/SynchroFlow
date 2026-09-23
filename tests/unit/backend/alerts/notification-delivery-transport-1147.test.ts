import {
  createNotificationDeliveryTransport,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
} from 'api-src/services/notifications/notificationDeliveryTransport.service';
import type {
  PreparedDelivery,
  PushDestination,
} from 'api-src/services/notifications/notificationDeliveryExecution.service';
import type { PushSubscription, RequestDetails, RequestOptions } from 'web-push';

const config = {
  VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private',
  VAPID_MAILTO: 'mailto:ops@example.com', RESEND_API_KEY: 'test-key',
  FRONTEND_URL: 'https://app.example.com',
};
const common = {
  deliveryId: 'delivery-1', notificationEventId: 'event-1', shopId: 1, userId: 2,
  title: '<Attention>', body: 'Orders & stock',
  action: { route: '/orders?status=open', label: 'Open <orders>' },
};
const web: PushDestination = {
  kind: 'web', id: 'web-1', updatedAt: '2026-09-23 12:00:00.123456+00',
  endpoint: 'https://push.example.com/1', p256dh: 'key', auth: 'auth',
};
function expo(id: string): PushDestination {
  return { kind: 'expo', id, updatedAt: web.updatedAt, expoPushToken: `ExponentPushToken[${id}]` };
}
function push(destinations: readonly PushDestination[] = [web]): PreparedDelivery {
  return { ...common, channel: 'push', destinations };
}
const email: PreparedDelivery = { ...common, channel: 'email', recipient: 'user@example.com' };
function response(status: number, body: unknown = {}, headers: Record<string, string> = {}): ProviderHttpResponse {
  return { status, body: JSON.stringify(body), headers };
}
function setup(responses: ProviderHttpResponse[] = [response(201)]) {
  const http = jest.fn(async (_request: ProviderHttpRequest, _signal: AbortSignal) => {
    const result = responses.shift();
    if (!result) throw new Error('Unexpected HTTP request');
    return result;
  });
  const generateWebRequest = jest.fn((_subscription: PushSubscription, _payload: string, _options: RequestOptions): RequestDetails => ({
    endpoint: 'https://push.example.com/1', method: 'POST',
    headers: {}, body: Buffer.from('encrypted'),
  }));
  const transport = createNotificationDeliveryTransport({ http, generateWebRequest, config });
  const controller = new AbortController();
  const control = { signal: controller.signal, deadlineAt: Date.now() + 20_000 };
  return { http, generateWebRequest, transport, controller, control };
}

describe('GH-1147 durable provider transport', () => {
  it('accepts Web Push and supplies top-level action url to encryption', async () => {
    const s = setup();
    expect(await s.transport(push(), s.control)).toMatchObject({ kind: 'accepted', providerMessageId: null });
    expect(s.http.mock.calls[0][1]).toBe(s.control.signal);
    const payload = JSON.parse(s.generateWebRequest.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: common.title,
      body: common.body,
      tag: 'lasyncro-notification:event-1',
      url: 'https://app.example.com/orders?status=open',
    });
  });
  it('uses logical notification event identity as the Web Push tag across retry but not across distinct events', async () => {
    const s = setup([response(201), response(201), response(201)]);
    await s.transport(push(), s.control);
    await s.transport(push(), s.control);
    await s.transport({ ...push(), notificationEventId: 'EVENT-B' }, s.control);

    const tags = s.generateWebRequest.mock.calls.map((call) => {
      const payload = JSON.parse(call[1]);
      return payload.tag;
    });

    expect(tags[0]).toBe('lasyncro-notification:event-1');
    expect(tags[1]).toBe(tags[0]);
    expect(tags[2]).toBe('lasyncro-notification:EVENT-B');
    expect(tags[2]).not.toBe(tags[0]);
  });
  it.each([404, 410])('returns dead Web destination for %s', async (status) => {
    const s = setup([response(status)]);
    expect(await s.transport(push(), s.control)).toMatchObject({ kind: 'terminal_failure', deadDestinations: [web] });
  });
  it('retries Web 429 with Retry-After without deleting destination', async () => {
    const s = setup([response(429, {}, { 'retry-after': '12' })]);
    expect(await s.transport(push(), s.control)).toMatchObject({ kind: 'retryable_failure', retryAfterMs: 12_000, deadDestinations: [] });
  });
  it('retries Web abort and initiates no request after cancellation', async () => {
    const s = setup();
    s.controller.abort();
    expect(await s.transport(push(), s.control)).toMatchObject({ kind: 'retryable_failure' });
    expect(s.http).not.toHaveBeenCalled();
  });
  it('classifies missing VAPID configuration as terminal', async () => {
    const s = setup();
    const transport = createNotificationDeliveryTransport({ http: s.http, config: {} });
    expect(await transport(push(), s.control)).toMatchObject({ kind: 'terminal_failure' });
    expect(s.http).not.toHaveBeenCalled();
  });
  it('classifies encryption/configuration failure as terminal', async () => {
    const s = setup();
    s.generateWebRequest.mockImplementation(() => { throw new Error('invalid VAPID'); });
    expect(await s.transport(push(), s.control)).toMatchObject({ kind: 'terminal_failure' });
    expect(s.http).not.toHaveBeenCalled();
  });
  it('accepts one Expo ticket without fabricating delivery confirmation', async () => {
    const s = setup([response(200, { data: [{ status: 'ok', id: 'ticket' }] })]);
    const result = await s.transport(push([expo('1')]), s.control);
    expect(result).toMatchObject({ kind: 'accepted', providerMessageId: null });
    expect(result).not.toHaveProperty('delivered_at');
    expect(s.http.mock.calls[0][1]).toBe(s.control.signal);
  });
  it.each([
    [[{ status: 'ok', id: 'ticket' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }], 'accepted'],
    [[{ status: 'error', details: { error: 'InvalidCredentials' } }, { status: 'error', details: { error: 'MessageRateExceeded' } }], 'retryable_failure'],
    [[{ status: 'error', details: { error: 'MessageTooBig' } }, { status: 'error', details: { error: 'DeveloperError' } }], 'terminal_failure'],
  ])('aggregates Expo tickets %j as %s', async (tickets, kind) => {
    const s = setup([response(200, { data: tickets })]);
    expect(await s.transport(push([expo('1'), expo('2')]), s.control)).toMatchObject({ kind });
  });
  it('returns DeviceNotRegistered identity for safe cleanup', async () => {
    const s = setup([response(200, { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] })]);
    expect(await s.transport(push([expo('dead')]), s.control)).toMatchObject({ kind: 'terminal_failure', deadDestinations: [expo('dead')] });
  });
  it('preserves destination-ticket mapping across 100-device chunks', async () => {
    const destinations = Array.from({ length: 102 }, (_, i) => expo(String(i)));
    const s = setup([
      response(200, { data: Array.from({ length: 100 }, () => ({ status: 'ok', id: 'ticket' })) }),
      response(200, { data: [{ status: 'ok', id: 'ticket' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    ]);
    expect(await s.transport(push(destinations), s.control)).toMatchObject({ kind: 'accepted', deadDestinations: [destinations[101]] });
    expect(s.http).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(s.http.mock.calls[1][0].body))[1].to).toBe('ExponentPushToken[101]');
  });
  it('does not start later Expo chunks after abort', async () => {
    const s = setup();
    s.http.mockImplementation(async () => {
      s.controller.abort();
      throw new Error('aborted');
    });
    expect(await s.transport(push(Array.from({ length: 101 }, (_, i) => expo(String(i)))), s.control))
      .toMatchObject({ kind: 'retryable_failure' });
    expect(s.http).toHaveBeenCalledTimes(1);
  });
  it.each(['Unknown', 'ProviderError', 'MessageRateExceeded'])('retries Expo %s safely', async (error) => {
    const s = setup([response(200, { data: [{ status: 'error', details: { error } }] })]);
    expect(await s.transport(push([expo('1')]), s.control)).toMatchObject({ kind: 'retryable_failure', deadDestinations: [] });
  });
  it('retries unknown Expo request errors without deleting destinations', async () => {
    const s = setup([response(400, { errors: [{ code: 'Unknown' }] })]);
    expect(await s.transport(push([expo('1')]), s.control)).toMatchObject({ kind: 'retryable_failure', deadDestinations: [] });
  });
  it.each(['web', 'expo', 'email'])('interrupts in-flight %s work through the supplied signal', async (channel) => {
    const s = setup();
    s.http.mockImplementation(async (_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      s.controller.abort();
    }));
    expect(await s.transport(channel === 'email' ? email : push(channel === 'expo' ? [expo('1')] : [web]), s.control))
      .toMatchObject({ kind: 'retryable_failure' });
    expect(s.http).toHaveBeenCalledTimes(1);
    expect(s.http.mock.calls[0][0].deadlineAt).toBe(s.control.deadlineAt);
  });
  it('keeps prior acceptance when later Expo work aborts', async () => {
    const s = setup([response(201)]);
    s.http.mockImplementationOnce(async () => response(201)).mockImplementationOnce(async () => {
      s.controller.abort();
      throw new Error('aborted');
    });
    expect(await s.transport(push([web, expo('1')]), s.control)).toMatchObject({ kind: 'accepted', providerMessageId: null });
  });
  it('accepts Resend ID with exact durable idempotency key and escaped content', async () => {
    const s = setup([response(200, { id: 'email-message' })]);
    const result = await s.transport(email, s.control);
    expect(result).toEqual({ kind: 'accepted', providerMessageId: 'email-message' });
    expect(result).not.toHaveProperty('delivered_at');
    expect(s.http.mock.calls[0][0].headers).toMatchObject({ 'Idempotency-Key': 'notification-delivery:delivery-1' });
    expect(s.http.mock.calls[0][1]).toBe(s.control.signal);
    const body = JSON.parse(String(s.http.mock.calls[0][0].body));
    expect(body).toMatchObject({ from: 'noreply@lasyncro.com', to: ['user@example.com'], subject: common.title });
    expect(body.html).toContain('&lt;Attention&gt;');
    expect(body.html).toContain('Orders &amp; stock');
    expect(body.text).toContain(common.body);
  });
  it.each([408, 429, 500, 503])('retries Resend HTTP %s', async (status) => {
    const s = setup([response(status)]);
    expect(await s.transport(email, s.control)).toMatchObject({ kind: 'retryable_failure' });
  });
  it.each(['network', 'abort'])('retries Resend %s', async (failure) => {
    const s = setup();
    s.http.mockImplementation(async () => { throw new Error(failure); });
    expect(await s.transport(email, s.control)).toMatchObject({ kind: 'retryable_failure' });
  });
  it.each([
    ['concurrent_idempotent_requests', 'retryable_failure'],
    ['invalid_idempotent_request', 'terminal_failure'],
  ])('classifies Resend %s as %s', async (name, kind) => {
    const s = setup([response(409, { name })]);
    expect(await s.transport(email, s.control)).toMatchObject({ kind });
  });
  it.each([400, 401, 403, 422])('classifies permanent Resend %s as terminal', async (status) => {
    const s = setup([response(status)]);
    expect(await s.transport(email, s.control)).toMatchObject({ kind: 'terminal_failure' });
  });
  it('rejects missing email credentials before HTTP', async () => {
    const s = setup();
    const transport = createNotificationDeliveryTransport({ http: s.http, config: {} });
    expect(await transport(email, s.control)).toMatchObject({ kind: 'terminal_failure' });
    expect(s.http).not.toHaveBeenCalled();
  });
});
