/**
 * GH-979 C — staged rollout of the state-bound reconnect finalizer (DB-free).
 *
 * The executor driver is exercised against a mocked pg client: no database,
 * no provider. Proves only call routing: ordinary reconnects keep the 0217
 * 14-parameter finalizer, the 15-parameter overload is used only when a hash is
 * supplied AND attested executable, and a pre-0220 epoch never claims a proof.
 */
const mockQueries: { sql: string; values?: unknown[] }[] = [];
const mockRole = { stateBound: true, legacy: true };
const mockClient = {
  query: jest.fn(async (sql: string, values?: unknown[]) => {
    mockQueries.push({ sql, values });
    if (sql.includes('WHERE r.rolname = session_user')) {
      return { rows: [{ session_role: 'sf_shopify_reconnect_executor',
        current_role: 'sf_shopify_reconnect_executor', rolcanlogin: true, rolsuper: false,
        rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false,
        schema_usage: true, finalizer_execute: mockRole.legacy,
        state_bound_execute: mockRole.stateBound, has_membership: false }] };
    }
    if (sql.includes('shopify_reconnect_private.finalize_reconnect(')) {
      return { rows: [{ generation: '7', integration_id: 3 }] };
    }
    return { rows: [] };
  }),
  release: jest.fn(),
};
jest.mock('pg', () => {
  class DatabaseError extends Error { code?: string; }
  const Pool = jest.fn(() => ({ connect: async () => mockClient, on: jest.fn(), end: jest.fn(async () => undefined) }));
  return { __esModule: true, default: { Pool, DatabaseError }, Pool, DatabaseError };
});
jest.mock('api-src/security/encryption.service', () => ({ encrypt: (value: string) => `enc:${value.length}` }));
jest.mock('api-src/services/shopify/shopifyScopes', () => ({
  normalizeAndValidateShopifyGrantedScopes: (scopes: string) => scopes,
}));

import {
  assertShopifyReconnectExecutorReady,
  executeShopifyReconnectFinalizer,
} from 'api-src/services/shopify/shopifyReconnectExecutor.db';

const HASH = 'a'.repeat(64);
const owner = { shopId: 11, installationId: 22, shopDomain: 'gh979.myshopify.com',
  installationState: 'ACTIVE' as const, generation: '7', leaseToken: '00000000-0000-4000-8000-000000000001' };
const credentials = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
  accessExpiresAt: new Date('2030-01-01T00:00:00Z'), refreshExpiresAt: new Date('2030-02-01T00:00:00Z'),
  grantedScopes: 'read_products',
  shopIdentity: { gid: 'gid://shopify/Shop/11', currencyCode: 'EUR', name: null, contactEmail: null,
    ianaTimezone: null } } as any;
const finalizeCalls = () => mockQueries.filter(q => q.sql.includes('shopify_reconnect_private.finalize_reconnect(')
  && q.sql.startsWith('SELECT generation'));

beforeAll(() => {
  process.env.SHOPIFY_RECONNECT_DATABASE_URL =
    'postgresql://sf_shopify_reconnect_executor:synthetic@db.invalid:5432/synchroflow_test_gh979?sslmode=disable';
});
beforeEach(() => {
  mockQueries.length = 0;
  mockRole.stateBound = true;
  mockRole.legacy = true;
});

it('an ordinary reconnect keeps the 14-parameter finalizer even when the overload exists', async () => {
  await expect(executeShopifyReconnectFinalizer(owner, credentials)).resolves
    .toEqual({ kind: 'RECONNECTED', generation: '7', integration: { id: 3 }, recoveryProof: false });
  const [call] = finalizeCalls();
  expect(finalizeCalls()).toHaveLength(1);
  expect(call.sql).toContain('$14::text)');
  expect(call.sql).not.toContain('$15');
  expect(call.values).toHaveLength(14);
});

it('a state-bound reconnect uses the attested overload and reports the committed proof', async () => {
  await expect(executeShopifyReconnectFinalizer(owner, credentials, HASH)).resolves
    .toMatchObject({ kind: 'RECONNECTED', recoveryProof: true });
  const [call] = finalizeCalls();
  expect(call.sql).toContain('$15::text)');
  expect(call.values).toHaveLength(15);
  expect(call.values?.[14]).toBe(HASH);
});

it('before migration 0220 a hash never requires the overload and never claims a proof', async () => {
  mockRole.stateBound = false;
  await expect(executeShopifyReconnectFinalizer(owner, credentials, HASH)).resolves
    .toMatchObject({ kind: 'RECONNECTED', recoveryProof: false });
  const [call] = finalizeCalls();
  expect(call.sql).not.toContain('$15');
  expect(call.values).toHaveLength(14);
  expect(call.values).not.toContain(HASH);
  await expect(assertShopifyReconnectExecutorReady()).resolves.toBeUndefined();
});

it('attestation still requires the protected 14-parameter finalizer in every epoch', async () => {
  mockRole.legacy = false;
  await expect(executeShopifyReconnectFinalizer(owner, credentials, HASH))
    .rejects.toThrow('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
  expect(finalizeCalls()).toHaveLength(0);
});

it('a malformed state hash is refused before any connection or finalization', async () => {
  for (const hash of ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}g`]) {
    await expect(executeShopifyReconnectFinalizer(owner, credentials, hash))
      .rejects.toThrow('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
  }
  expect(mockQueries).toHaveLength(0);
});

it('the overload attestation is NULL-safe when the function does not exist', async () => {
  await assertShopifyReconnectExecutorReady();
  const attestation = mockQueries.find(q => q.sql.includes('WHERE r.rolname = session_user'))!.sql;
  expect(attestation).toContain('COALESCE(pg_catalog.has_function_privilege(current_user,');
  expect(attestation).toContain("pg_catalog.to_regprocedure('shopify_reconnect_private.finalize_reconnect(");
});
