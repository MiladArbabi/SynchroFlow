import https from 'node:https';
import webpush from 'web-push';
import type {
  DeliveryTransport,
  DeliveryTransportResult,
  PreparedDelivery,
  PushDestination,
} from './notificationDeliveryExecution.service.js';

export type ProviderHttpRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Buffer | null;
  deadlineAt: number;
};
export type ProviderHttpResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
};
type ProviderHttp = (request: ProviderHttpRequest, signal: AbortSignal) => Promise<ProviderHttpResponse>;
type WebRequestGenerator = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => webpush.RequestDetails;
type Config = Readonly<Record<string, string | undefined>>;
type Control = Parameters<DeliveryTransport>[1];
const EXPO_CHUNK_SIZE = 100;

const retry = (error: string, retryAfterMs?: number): DeliveryTransportResult => ({
  kind: 'retryable_failure', error, ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
});
const terminal = (error: string): DeliveryTransportResult => ({
  kind: 'terminal_failure', error, terminalReason: 'provider_rejected',
});

const requestHttps: ProviderHttp = (input, signal) => new Promise((resolve, reject) => {
  const remaining = input.deadlineAt - Date.now();
  if (signal.aborted || !Number.isFinite(remaining) || remaining <= 0) { reject(new Error('PROVIDER_ABORTED')); return; }
  const request = https.request(input.url, {
    method: input.method, headers: input.headers, signal,
  }, (response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        request.destroy(new Error('PROVIDER_RESPONSE_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(response.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
      resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') });
    });
  });
  // A wall-clock deadline, independent of socket activity, includes reading the response.
  const timeout = setTimeout(() => request.destroy(new Error('PROVIDER_DEADLINE')), remaining);
  request.on('close', () => clearTimeout(timeout));
  request.on('error', reject);
  request.end(input.body);
});

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function json(body: string): Record<string, unknown> {
  try { return object(JSON.parse(body)); } catch { return {}; }
}
function retryAfter(response: ProviderHttpResponse): number | undefined {
  const value = response.headers['retry-after'];
  if (!value?.trim()) return undefined;
  const milliseconds = /^\d+(\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}
function httpFailure(response: ProviderHttpResponse): DeliveryTransportResult {
  const status = response.status;
  return status === 408 || status === 429 || status >= 500 || status < 400
    ? retry(`PROVIDER_HTTP_${status}`, retryAfter(response))
    : terminal(`PROVIDER_HTTP_${status}`);
}
function active(control: Control): boolean {
  return !control.signal.aborted && Number.isFinite(control.deadlineAt) && Date.now() < control.deadlineAt;
}
function actionUrl(delivery: PreparedDelivery, config: Config): string | null {
  if (delivery.action === null) return null;
  const base = new URL(config.FRONTEND_URL ?? 'https://app.lasyncro.com');
  const route = delivery.action.route;
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password ||
      typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') ||
      /[\\\x00-\x20]/.test(route)) throw new Error('INVALID_ACTION_URL');
  const url = new URL(route, base);
  if (url.origin !== base.origin) throw new Error('INVALID_ACTION_URL');
  return url.href;
}
function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function createNotificationDeliveryTransport(options: {
  http?: ProviderHttp;
  generateWebRequest?: WebRequestGenerator;
  config?: Config;
} = {}): DeliveryTransport {
  const http = options.http ?? requestHttps;
  const generateWebRequest = options.generateWebRequest ?? webpush.generateRequestDetails;
  const config = options.config ?? process.env;

  async function web(destination: Extract<PushDestination, { kind: 'web' }>, delivery: PreparedDelivery, url: string | null, control: Control): Promise<DeliveryTransportResult> {
    if (!active(control)) return retry('PROVIDER_ABORTED');
    let details: webpush.RequestDetails;
    try {
      if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_MAILTO) return terminal('WEB_PUSH_CONFIGURATION');
      if (!destination.endpoint || !destination.p256dh || !destination.auth) return terminal('WEB_PUSH_DESTINATION');
      const endpoint = new URL(destination.endpoint);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return terminal('WEB_PUSH_DESTINATION');
      details = generateWebRequest({
        endpoint: destination.endpoint, keys: { p256dh: destination.p256dh, auth: destination.auth },
      }, JSON.stringify({
        title: delivery.title,
        body: delivery.body,
        tag: `lasyncro-notification:${delivery.notificationEventId}`,
        ...(url ? { url } : {}),
      }), {
        vapidDetails: { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_MAILTO },
      });
    } catch { return terminal('WEB_PUSH_CONFIGURATION_OR_PAYLOAD'); }
    if (!active(control)) return retry('PROVIDER_ABORTED');
    try {
      const response = await http({ url: details.endpoint, method: details.method, headers: details.headers, body: details.body, deadlineAt: control.deadlineAt }, control.signal);
      if (response.status >= 200 && response.status < 300) return { kind: 'accepted' };
      if (response.status === 404 || response.status === 410) return { ...terminal('WEB_PUSH_DEAD'), deadDestinations: [destination] };
      return httpFailure(response);
    } catch { return retry('WEB_PUSH_NETWORK_OR_ABORT'); }
  }

  async function push(delivery: Extract<PreparedDelivery, { channel: 'push' }>, url: string | null, control: Control): Promise<DeliveryTransportResult> {
    const results: DeliveryTransportResult[] = [];
    for (const destination of delivery.destinations) {
      if (destination.kind !== 'web') continue;
      if (!active(control)) { results.push(retry('PROVIDER_ABORTED')); break; }
      results.push(await web(destination, delivery, url, control));
    }
    const expo = delivery.destinations.filter((d): d is Extract<PushDestination, { kind: 'expo' }> => d.kind === 'expo');
    for (let offset = 0; offset < expo.length; offset += EXPO_CHUNK_SIZE) {
      if (!active(control)) { results.push(retry('PROVIDER_ABORTED')); break; }
      const chunk = expo.slice(offset, offset + EXPO_CHUNK_SIZE);
      // Keep ticket indices tied to the exact submitted chunk, including filtered tokens.
      const valid = chunk.filter((destination) => {
        const token = destination.expoPushToken;
        if (typeof token === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[^\]\s]+\]$/.test(token)) return true;
        results.push(terminal('EXPO_INVALID_DESTINATION'));
        return false;
      });
      if (!valid.length) continue;
      try {
        const response = await http({
          url: 'https://exp.host/--/api/v2/push/send', method: 'POST',
          deadlineAt: control.deadlineAt,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(valid.map((d) => ({
            to: d.expoPushToken, title: delivery.title, body: delivery.body, sound: 'default',
            ...(url ? { data: { url } } : {}),
          }))),
        }, control.signal);
        if (response.status < 200 || response.status >= 300) {
          const errors = json(response.body).errors;
          const permanent = Array.isArray(errors) && errors.length > 0 && errors.every((error: unknown) =>
            ['InvalidCredentials', 'MessageTooBig', 'DeveloperError'].includes(String(object(error).code)));
          results.push(permanent && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429
            ? terminal('EXPO_REQUEST_REJECTED')
            : retry('EXPO_REQUEST_TRANSIENT_OR_UNKNOWN', retryAfter(response)));
          continue;
        }
        const data = json(response.body).data;
        if (!Array.isArray(data) || data.length !== valid.length) {
          results.push(retry('EXPO_UNKNOWN_RESPONSE'));
          continue;
        }
        data.forEach((value: unknown, index: number) => {
          const ticket = object(value);
          const error = object(ticket.details).error;
          if (ticket.status === 'ok' && typeof ticket.id === 'string' && ticket.id.length > 0) {
            results.push({ kind: 'accepted' });
          } else if (ticket.status === 'error' && error === 'DeviceNotRegistered') {
            results.push({ ...terminal('EXPO_DEVICE_NOT_REGISTERED'), deadDestinations: [valid[index]] });
          } else if (ticket.status === 'error' && ['InvalidCredentials', 'MessageTooBig', 'DeveloperError'].includes(String(error))) {
            results.push(terminal(`EXPO_${String(error)}`));
          } else {
            results.push(retry('EXPO_TRANSIENT_OR_UNKNOWN', retryAfter(response)));
          }
        });
      } catch { results.push(retry('EXPO_NETWORK_OR_ABORT')); }
    }
    const deadDestinations = results.flatMap((result) => result.deadDestinations ?? []);
    if (results.some((result) => result.kind === 'accepted')) return { kind: 'accepted', providerMessageId: null, deadDestinations };
    const retryable = results.filter((result): result is Extract<DeliveryTransportResult, { kind: 'retryable_failure' }> => result.kind === 'retryable_failure');
    if (retryable.length) {
      const delay = Math.max(0, ...retryable.map((result) => result.retryAfterMs ?? 0));
      return { ...retry('PUSH_RETRYABLE', delay || undefined), deadDestinations };
    }
    return { ...terminal('PUSH_TERMINAL'), deadDestinations };
  }

  async function email(delivery: Extract<PreparedDelivery, { channel: 'email' }>, url: string | null, control: Control): Promise<DeliveryTransportResult> {
    const sender = config.RESEND_FROM_EMAIL ?? 'noreply@lasyncro.com';
    if (!config.RESEND_API_KEY?.trim() || /[\r\n]/.test(config.RESEND_API_KEY) ||
        !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)) return terminal('RESEND_CONFIGURATION');
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(delivery.recipient)) return terminal('EMAIL_DESTINATION');
    if (!active(control)) return retry('PROVIDER_ABORTED');
    try {
      const response = await http({
        url: 'https://api.resend.com/emails', method: 'POST',
        deadlineAt: control.deadlineAt,
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `notification-delivery:${delivery.deliveryId}`,
        },
        body: JSON.stringify({
          from: sender, to: [delivery.recipient], subject: delivery.title,
          html: `<h2>${escapeHtml(delivery.title)}</h2><p>${escapeHtml(delivery.body)}</p>${url && delivery.action ? `<p><a href="${escapeHtml(url)}">${escapeHtml(delivery.action.label)}</a></p>` : ''}`,
          text: `${delivery.title}\n\n${delivery.body}${url && delivery.action ? `\n\n${delivery.action.label}: ${url}` : ''}`,
        }),
      }, control.signal);
      const body = json(response.body);
      if (response.status >= 200 && response.status < 300) {
        return typeof body.id === 'string' && body.id.trim()
          ? { kind: 'accepted', providerMessageId: body.id } : retry('RESEND_UNKNOWN_RESPONSE');
      }
      if (body.name === 'concurrent_idempotent_requests') return retry('RESEND_CONCURRENT_IDEMPOTENT_REQUEST', retryAfter(response));
      if (body.name === 'invalid_idempotent_request') return terminal('RESEND_INVALID_IDEMPOTENT_REQUEST');
      return httpFailure(response);
    } catch { return retry('RESEND_NETWORK_OR_ABORT'); }
  }

  return async (delivery, control) => {
    if (!active(control)) return retry('PROVIDER_ABORTED');
    let url: string | null;
    try {
      if (typeof delivery.title !== 'string' || typeof delivery.body !== 'string' ||
          (delivery.action !== null && typeof delivery.action.label !== 'string')) return terminal('INVALID_DELIVERY_PAYLOAD');
      url = actionUrl(delivery, config);
    } catch { return terminal('INVALID_ACTION_URL'); }
    return delivery.channel === 'push' ? push(delivery, url, control) : email(delivery, url, control);
  };
}
