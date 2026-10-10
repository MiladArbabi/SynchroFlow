/** SHOP-REVIEW-AUTH-01 RED-3B — refresh transport/parsing only; no DB/T2. */
jest.mock('axios', () => {
  const blocked = jest.fn(() => { throw new Error('PROVIDER_NETWORK_ESCAPE_BLOCKED'); });
  const client = { post: jest.fn(), get: blocked, request: blocked, put: blocked,
    patch: blocked, delete: blocked, create: () => client,
    isAxiosError: (err: any) => err?.isAxiosError === true };
  return { __esModule: true, default: client };
});

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { SHOPIFY_REQUIRED_SCOPE_STRING, normalizeAndValidateShopifyGrantedScopes } from 'api-src/services/shopify/shopifyScopes';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const SHOP = 'red3b-provider-fixture.myshopify.com';
const URL = `https://${SHOP}/admin/oauth/access_token`;
const OLD_REFRESH = 'red3b-provider-old-refresh-secret';
const NEW_ACCESS = 'red3b-provider-new-access-secret';
const NEW_REFRESH = 'red3b-provider-new-refresh-secret';
const SECRET = 'red3b-provider-client-secret';
const HEADER_SECRET = 'red3b-provider-header-secret';
const SENTINELS = [OLD_REFRESH, NEW_ACCESS, NEW_REFRESH, SECRET, HEADER_SECRET];
const post = (axios as unknown as { post: jest.Mock }).post;

type Outcome = {
  kind: 'SUCCESS' | 'RETRYABLE' | 'AMBIGUOUS' | 'REAUTH_REQUIRED' | 'PROVIDER_REJECTED';
  credentials?: { accessToken: string; refreshToken: string; grantedScopes: string;
    accessExpiresAt: Date; refreshExpiresAt: Date };
  diagnostics?: { message?: string; status?: number; code?: string };
};

async function refresh(): Promise<Outcome> {
  const file = path.resolve(__dirname, '../../../../apps/backend/src/services/shopify/shopifyAdminCredentialRefreshProvider.service.ts');
  const exports = fs.existsSync(file) ? require(file) : {};
  if (typeof exports.refreshShopifyAdminCredential !== 'function') {
    throw new Error('MISSING_IMPLEMENTATION: refreshShopifyAdminCredential');
  }
  return exports.refreshShopifyAdminCredential({ shopDomain: SHOP, refreshToken: OLD_REFRESH, now: NOW });
}

function grant() {
  return { access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 86400,
    refresh_token_expires_in: 2592000, scope: SHOPIFY_REQUIRED_SCOPE_STRING };
}
function axiosFailure(status?: number, error = 'provider_request_rejected', code = 'ERR_BAD_REQUEST') {
  return Object.assign(new Error('Shopify transport failed'), { isAxiosError: true, code,
    response: status === undefined ? undefined : { status, data: { error } } });
}
let response: unknown;
let rejection: unknown;
let networkEscape: boolean;
let logs: unknown[][];
let spies: jest.SpyInstance[];
let originalKey: string | undefined;
let originalSecret: string | undefined;

beforeAll(() => {
  originalKey = process.env.SHOPIFY_API_KEY;
  originalSecret = process.env.SHOPIFY_API_SECRET;
});
beforeEach(() => {
  process.env.SHOPIFY_API_KEY = 'red3b-provider-client-id';
  process.env.SHOPIFY_API_SECRET = SECRET;
  response = { data: grant() };
  rejection = undefined;
  networkEscape = false;
  logs = [];
  post.mockReset();
  post.mockImplementation(async (url: unknown) => {
    if (url !== URL) { networkEscape = true; throw new Error('PROVIDER_NETWORK_ESCAPE_BLOCKED'); }
    if (rejection !== undefined) throw rejection;
    return response;
  });
  spies = ['error', 'warn', 'log', 'info', 'debug'].map(method =>
    jest.spyOn(console, method as 'error').mockImplementation((...args: unknown[]) => { logs.push(args); }));
  spies.push(jest.spyOn(global, 'fetch').mockImplementation(async () => {
    networkEscape = true;
    throw new Error('PROVIDER_NETWORK_ESCAPE_BLOCKED');
  }));
});
afterEach(() => {
  try {
    expect(networkEscape).toBe(false);
    const serialized = JSON.stringify(logs);
    // Booleans prevent Jest failure output from printing a sentinel secret.
    expect(SENTINELS.some(secret => serialized.includes(secret))).toBe(false);
  } finally { spies.forEach(spy => spy.mockRestore()); }
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.SHOPIFY_API_KEY;
  else process.env.SHOPIFY_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = originalSecret;
});

describe('RED-3B refresh provider boundary — mocked transport, no persistence', () => {
  it('CONTROL: canonical scope authority is available and rejects incomplete grants', () => {
    const normalized = normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING);
    expect(normalized).toBe(SHOPIFY_REQUIRED_SCOPE_STRING.split(',').sort().join(','));
    expect(() => normalizeAndValidateShopifyGrantedScopes('')).toThrow('SHOPIFY_GRANTED_SCOPES_MISSING');
  });

  it('R3B-K: refresh sends exact refresh-grant inputs and a 10-second timeout', async () => {
    expect((await refresh()).kind).toBe('SUCCESS');
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, options] = post.mock.calls[0];
    expect(url).toBe(URL);
    expect(Object.keys(body).sort()).toEqual(['client_id', 'client_secret', 'grant_type', 'refresh_token']);
    expect(body.client_id === process.env.SHOPIFY_API_KEY).toBe(true);
    expect(body.client_secret === SECRET).toBe(true);
    expect(body.refresh_token === OLD_REFRESH).toBe(true);
    expect(body.grant_type).toBe('refresh_token');
    expect(options.timeout).toBe(10000);
  });

  it('R3B-L: valid success returns complete normalized replacement and one expiry base', async () => {
    const result = await refresh();
    expect(result.kind).toBe('SUCCESS');
    expect(result.credentials).toBeDefined();
    const credentials = result.credentials!;
    expect(credentials.accessToken === NEW_ACCESS).toBe(true);
    expect(credentials.refreshToken === NEW_REFRESH).toBe(true);
    expect(credentials.grantedScopes).toBe(normalizeAndValidateShopifyGrantedScopes(grant().scope));
    expect(new Date(credentials.accessExpiresAt).getTime()).toBe(NOW.getTime() + 86400000);
    expect(new Date(credentials.refreshExpiresAt).getTime()).toBe(NOW.getTime() + 2592000000);
  });

  it.each(['ENOTFOUND', 'ECONNRESET'])('R3B-M: network %s is RETRYABLE', async code => {
    rejection = axiosFailure(undefined, 'network', code);
    expect((await refresh()).kind).toBe('RETRYABLE');
  });

  it('R3B-N: transport timeout is RETRYABLE', async () => {
    rejection = axiosFailure(undefined, 'timeout', 'ECONNABORTED');
    expect((await refresh()).kind).toBe('RETRYABLE');
  });

  it('R3B-O: HTTP 429 is RETRYABLE, not merchant reauth', async () => {
    rejection = axiosFailure(429);
    expect((await refresh()).kind).toBe('RETRYABLE');
  });

  it('R3B-P: HTTP 503 is RETRYABLE', async () => {
    rejection = axiosFailure(503, 'server_error', 'ERR_BAD_RESPONSE');
    expect((await refresh()).kind).toBe('RETRYABLE');
  });

  it('R3B-Q: only HTTP 401 plus invalid_request requires reauth', async () => {
    rejection = axiosFailure(401, 'invalid_request');
    expect((await refresh()).kind).toBe('REAUTH_REQUIRED');
  });

  it.each([[400, 'invalid_request'], [403, 'forbidden'], [401, 'unauthorized']])(
    'R3B-R: other HTTP %s / %s is PROVIDER_REJECTED', async (status, error) => {
      rejection = axiosFailure(Number(status), String(error));
      expect((await refresh()).kind).toBe('PROVIDER_REJECTED');
    });

  it.each([
    ['missing replacement refresh token', { ...grant(), refresh_token: undefined }],
    ['missing access token', { ...grant(), access_token: undefined }],
    ['blank refresh token', { ...grant(), refresh_token: '   ' }],
    ['blank access token', { ...grant(), access_token: '   ' }],
    ['missing access duration', { ...grant(), expires_in: undefined }],
    ['missing refresh duration', { ...grant(), refresh_token_expires_in: undefined }],
    ['zero duration', { ...grant(), expires_in: 0 }],
    ['negative duration', { ...grant(), refresh_token_expires_in: -1 }],
    ['nonfinite duration', { ...grant(), expires_in: Infinity }],
    ['non-numeric duration', { ...grant(), expires_in: {} }],
    ['missing scope', { ...grant(), scope: undefined }],
    ['null scope', { ...grant(), scope: null }],
    ['empty scope', { ...grant(), scope: '   ' }],
    ['malformed body', null],
  ])('R3B-S: %s is retryable/ambiguous without partial credentials', async (_label, data) => {
    response = { data };
    const result = await refresh();
    expect(['RETRYABLE', 'AMBIGUOUS']).toContain(result.kind);
    expect(result.credentials).toBeUndefined();
  });

  it('CORRECTIVE-2: delimiter-only provider scope is AMBIGUOUS without partial credentials', async () => {
    response = { data: { ...grant(), scope: ' , ' } };
    const result = await refresh();
    expect(result.credentials).toBeUndefined();
    expect(result.kind).toBe('AMBIGUOUS');
  });

  it('R3B-S: present parseable scope missing canonical required authorization is REAUTH_REQUIRED', async () => {
    const insufficientScope = SHOPIFY_REQUIRED_SCOPE_STRING.split(',').slice(1).join(',');
    expect(() => normalizeAndValidateShopifyGrantedScopes(insufficientScope))
      .toThrow('SHOPIFY_REQUIRED_SCOPES_MISSING');
    response = { data: { ...grant(), scope: insufficientScope } };
    const result = await refresh();
    expect(result.kind).toBe('REAUTH_REQUIRED');
    expect(result.credentials).toBeUndefined();
  });

  it('R3B-T: raw Axios secrets never cross the error or logging boundary', async () => {
    rejection = Object.assign(new Error(`Transport rejected ${OLD_REFRESH}`), {
      isAxiosError: true, code: 'ECONNRESET',
      config: { data: { client_secret: SECRET, refresh_token: OLD_REFRESH },
        headers: { 'X-Shopify-Access-Token': HEADER_SECRET } },
      request: { _header: HEADER_SECRET },
      response: { status: 503, data: { access_token: NEW_ACCESS, refresh_token: NEW_REFRESH },
        headers: { authorization: HEADER_SECRET } },
    });
    const result = await refresh();
    expect(result.kind).toBe('RETRYABLE');
    expect(Object.keys(result).every(key => ['kind', 'diagnostics'].includes(key))).toBe(true);
    if (result.diagnostics) {
      expect(Object.keys(result.diagnostics).every(key => ['message', 'status', 'code'].includes(key))).toBe(true);
      expect(Object.values(result.diagnostics).every(value => value === undefined
        || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))).toBe(true);
    }
    const serialized = JSON.stringify({ result, logs });
    expect(SENTINELS.some(secret => serialized.includes(secret))).toBe(false);
    expect(['client_secret', 'refresh_token', 'access_token', 'X-Shopify-Access-Token',
      '"config"', '"request"', '"headers"'].some(field => serialized.includes(field))).toBe(false);
  });
});
