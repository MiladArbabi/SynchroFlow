/** SHOP-REVIEW-AUTH-01 RED-3B — real tenant/credential T1, no provider or T2. */
jest.mock('axios', () => {
  const blocked = jest.fn(() => { throw new Error('PROVIDER_NETWORK_ESCAPE_BLOCKED'); });
  const client = { post: blocked, get: blocked, request: blocked, put: blocked,
    patch: blocked, delete: blocked, create: () => client, isAxiosError: () => false };
  return { __esModule: true, default: client };
});

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import db, { systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt, decrypt } from 'api-src/security/encryption.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING, normalizeAndValidateShopifyGrantedScopes } from 'api-src/services/shopify/shopifyScopes';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const ACCESS = 'red3b-fixture-access-secret';
const REFRESH = 'red3b-fixture-refresh-secret';
const LIVE_LEASE = '92f341b2-09bd-4f96-928a-c9193056e7cd';
const GENERATION = '7';
const seconds = (value: number) => new Date(NOW.getTime() + value * 1000);
const transport = axios as unknown as { post: jest.Mock; get: jest.Mock; request: jest.Mock };

type Resolution = {
  kind: 'READY' | 'ROTATION_CLAIMED' | 'REAUTH_REQUIRED' | 'REFRESH_IN_PROGRESS';
  accessToken?: string;
  leaseToken?: string;
  generation?: number | string | bigint;
  refreshTokenEncrypted?: string;
};
type Boundary = (input: { shopId: number; now: Date }) => Promise<Resolution>;

/** Missing exports fail each behavioral case, never test-file import/discovery. */
function boundary(name: 'resolveShopifyAdminCredential' | 'claimShopifyAdminCredentialRotation'): Boundary {
  const file = path.resolve(__dirname, '../../apps/backend/src/services/shopify/shopifyAdminCredentialLifecycle.service.ts');
  const exports = fs.existsSync(file) ? require(file) : {};
  if (typeof exports[name] !== 'function') throw new Error(`MISSING_IMPLEMENTATION: ${name}`);
  return exports[name];
}

type Fixture = { shopId: number; installationId: number; credentialId: string };
async function fixture(overrides: Record<string, unknown> = {}): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const shopId = await systemTransaction(trx => createTenantShop(trx, `red3b-${suffix}`));
  return withTenant(shopId, async trx => {
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: `red3b-${suffix}.myshopify.com`,
      shop_gid: `gid://shopify/Shop/${shopId}`,
      scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      uninstalled_at: null,
    }).returning('id');
    const [credential] = await trx('shopify_admin_credentials').insert({
      installation_id: installation.id,
      shop_id: shopId,
      access_token_encrypted: encrypt(ACCESS),
      refresh_token_encrypted: encrypt(REFRESH),
      access_expires_at: seconds(600),
      refresh_expires_at: seconds(86400),
      granted_scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      credential_generation: GENERATION,
      ...overrides,
    }).returning('id');
    return { shopId, installationId: installation.id, credentialId: credential.id };
  });
}
async function row(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ id: f.credentialId }).first());
}
async function resolve(f: Fixture): Promise<Resolution> {
  return boundary('resolveShopifyAdminCredential')({ shopId: f.shopId, now: NOW });
}
async function claim(f: Fixture): Promise<Resolution> {
  return boundary('claimShopifyAdminCredentialRotation')({ shopId: f.shopId, now: NOW });
}
function expectNoUsableToken(result: Resolution) {
  expect(result.accessToken === undefined || result.accessToken === null).toBe(true);
}
function expectClaimUnchangedMaterial(before: any, after: any) {
  expect(after.credential_generation).toBe(before.credential_generation);
  expect(after.credential_state).toBe(before.credential_state);
  expect(after.access_token_encrypted).toBe(before.access_token_encrypted);
  expect(after.refresh_token_encrypted).toBe(before.refresh_token_encrypted);
  expect(after.access_expires_at).toEqual(before.access_expires_at);
  expect(after.refresh_expires_at).toEqual(before.refresh_expires_at);
}

let fetchSpy: jest.SpyInstance;
beforeAll(() => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'red3b-fixture-encryption-key-0123456789';
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
    throw new Error('PROVIDER_NETWORK_ESCAPE_BLOCKED');
  });
});
beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => {
  expect(transport.post).not.toHaveBeenCalled();
  expect(transport.get).not.toHaveBeenCalled();
  expect(transport.request).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});
afterAll(async () => { fetchSpy.mockRestore(); await db.destroy(); });

describe('RED-3B established real-Postgres/security controls', () => {
  it('CONTROL: ACTIVE default and exact two-state schema remain enforced', async () => {
    const f = await fixture();
    expect((await row(f)).credential_state).toBe('ACTIVE');
    await withTenant(f.shopId, trx => trx('shopify_admin_credentials')
      .where({ id: f.credentialId }).update({ credential_state: 'REAUTH_REQUIRED' }));
    expect((await row(f)).credential_state).toBe('REAUTH_REQUIRED');
    await expect(withTenant(f.shopId, trx => trx('shopify_admin_credentials')
      .where({ id: f.credentialId }).update({ credential_state: 'REFRESHING' })))
      .rejects.toMatchObject({ code: '23514' });
    await expect(withTenant(f.shopId, trx => trx('shopify_admin_credentials')
      .where({ id: f.credentialId }).update({ credential_state: 'ARBITRARY_STATE' })))
      .rejects.toMatchObject({ code: '23514' });
    await expect(withTenant(f.shopId, trx => trx('shopify_admin_credentials')
      .where({ id: f.credentialId }).update({ credential_state: null })))
      .rejects.toMatchObject({ code: '23502' });
  });

  it('CONTROL: generation default zero, bigint, NOT NULL and non-negative constraint remain', async () => {
    const f = await fixture({ credential_generation: undefined });
    expect(String((await row(f)).credential_generation)).toBe('0');
    const { rows } = await withTenant(f.shopId, trx => trx.raw(`
      SELECT a.attnotnull, t.typname
      FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
      WHERE a.attrelid = 'public.shopify_admin_credentials'::regclass
        AND a.attname = 'credential_generation'
    `));
    expect(rows).toEqual([{ attnotnull: true, typname: 'int8' }]);
    await expect(withTenant(f.shopId, trx => trx('shopify_admin_credentials')
      .where({ id: f.credentialId }).update({ credential_generation: -1 })))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('CONTROL: restricted runtime, FORCE RLS and composite installation/shop integrity', async () => {
    const own = await fixture();
    const other = await fixture();
    const proof = await withTenant(own.shopId, async trx => {
      const roles = await trx.raw('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      const tables = await trx.raw(`SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class WHERE oid IN ('public.shopify_admin_credentials'::regclass,
          'public.shopify_app_installations'::regclass)`);
      const hidden = await trx('shopify_admin_credentials').where({ id: other.credentialId });
      const hiddenInstallation = await trx('shopify_app_installations').where({ id: other.installationId });
      const changed = await trx('shopify_admin_credentials').where({ id: other.credentialId })
        .update({ rotation_lease_token: LIVE_LEASE });
      return { roles: roles.rows, tables: tables.rows, hidden, hiddenInstallation, changed };
    });
    expect(proof.roles).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    expect(proof.tables).toHaveLength(2);
    expect(proof.tables.every((table: any) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);
    expect(proof.hidden).toHaveLength(0);
    expect(proof.hiddenInstallation).toHaveLength(0);
    expect(proof.changed).toBe(0);
    expect((await row(other)).rotation_lease_token).toBeNull();
    // A canonical row already uses other.installationId; UNIQUE would mask the FK.
    // Seed an unbound installation in that SAME foreign tenant for the FK proof.
    const [unbound] = await withTenant(other.shopId, trx => trx('shopify_app_installations').insert({
      shop_id: other.shopId,
      shop_domain: `red3b-unbound-${crypto.randomUUID()}.myshopify.com`,
      shop_gid: `gid://shopify/Shop/${other.shopId}`,
      scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      uninstalled_at: null,
    }).returning('id'));
    await expect(withTenant(own.shopId, trx => trx('shopify_admin_credentials')
      .where({ id: own.credentialId }).update({ installation_id: unbound.id })))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('CONTROL: central encryption/decryption and canonical scope authority work', async () => {
    const f = await fixture();
    const stored = await row(f);
    expect(decrypt(stored.access_token_encrypted, 'shopify.dev') === ACCESS).toBe(true);
    expect(decrypt(stored.refresh_token_encrypted, 'shopify.dev') === REFRESH).toBe(true);
    expect(JSON.parse(stored.refresh_token_encrypted).key_version).toBe('v1');
    expect(stored.granted_scopes).toBe(normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING));
  });
});

describe('RED-3B resolution and short T1 claim — no provider/T2', () => {
  it('R3B-A: five minutes plus 1 ms is READY without a lease', async () => {
    const f = await fixture({ access_expires_at: new Date(NOW.getTime() + 300001) });
    const before = await row(f);
    const result = await resolve(f);
    expect(result.kind).toBe('READY');
    expect(result.accessToken === ACCESS).toBe(true);
    expect(await row(f)).toEqual(before);
  });

  it.each([['exactly five minutes', 300000], ['five minutes minus 1 ms', 299999]])(
    'R3B-B: %s is refresh-due', async (_label, milliseconds) => {
      const f = await fixture({ access_expires_at: new Date(NOW.getTime() + Number(milliseconds)) });
      const before = await row(f);
      expect((await resolve(f)).kind).toBe('ROTATION_CLAIMED');
      const after = await row(f);
      expect(after.rotation_lease_token).not.toBeNull();
      expectClaimUnchangedMaterial(before, after);
    });

  it.each([['at now', 0], ['before now', -1]])('R3B-C: access expired %s is never usable', async (_label, milliseconds) => {
    const f = await fixture({ access_expires_at: new Date(NOW.getTime() + Number(milliseconds)) });
    const result = await resolve(f);
    expect(result.kind).toBe('ROTATION_CLAIMED');
    expectNoUsableToken(result);
  });

  it('R3B-D: REAUTH_REQUIRED short-circuits even with fresh access', async () => {
    const f = await fixture({ credential_state: 'REAUTH_REQUIRED' });
    const before = await row(f);
    const result = await resolve(f);
    expect(result.kind).toBe('REAUTH_REQUIRED');
    expectNoUsableToken(result);
    expect(await row(f)).toEqual(before);
  });

  it.each([
    ['missing refresh token', { refresh_token_encrypted: null }],
    ['missing refresh expiry', { refresh_expires_at: null }],
    ['refresh expiry exactly now', { refresh_expires_at: NOW }],
    ['refresh already expired', { refresh_expires_at: seconds(-1) }],
  ])('R3B-E: %s requires reauth before lease/provider', async (_label, overrides) => {
    const f = await fixture({ access_expires_at: seconds(60), ...(overrides as Record<string, unknown>) });
    const before = await row(f);
    const result = await resolve(f);
    expect(result.kind).toBe('REAUTH_REQUIRED');
    expectNoUsableToken(result);
    const after = await row(f);
    expect(after.rotation_lease_token).toBeNull();
    expect(after.rotation_lease_expires_at).toBeNull();
    expect(after.rotation_started_at).toBeNull();
    // Classification only; terminal DB state/generation fencing belongs to RED-3C/D.
    expect(after.access_token_encrypted).toBe(before.access_token_encrypted);
    expect(after.refresh_token_encrypted).toBe(before.refresh_token_encrypted);
  });

  it('R3B-F: T1 holds the dedicated two-key transaction lock before credential reread', async () => {
    const f = await fixture({ access_expires_at: seconds(60) });
    const prototype = Object.getPrototypeOf(db.client);
    const original = prototype._query;
    let observed = false;
    let rereadAfterLock = false;
    let installationReadAfterLock = false;
    const spy = jest.spyOn(prototype, '_query').mockImplementation(async function(this: any, connection: any, query: any) {
      if (/\bselect\b/i.test(query.sql) && /shopify_admin_credentials/.test(query.sql) && observed) rereadAfterLock = true;
      if (/\bselect\b/i.test(query.sql) && /shopify_app_installations/.test(query.sql) && observed) installationReadAfterLock = true;
      const result = await original.call(this, connection, query);
      if (/pg_advisory_xact_lock/i.test(query.sql)) {
        const lock = await connection.query(`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
          AND pid = pg_backend_pid() AND objsubid = 2
          AND classid::bigint = (hashtext($1)::bigint + 4294967296) % 4294967296
          AND objid::bigint = $2
        ) AS held`, ['shopify_admin_credential_rotation', f.shopId]);
        observed = lock.rows[0].held && this.transacting === true;
      }
      return result;
    });
    try { expect((await claim(f)).kind).toBe('ROTATION_CLAIMED'); }
    finally { spy.mockRestore(); }
    expect(observed).toBe(true);
    expect(rereadAfterLock).toBe(true);
    expect(installationReadAfterLock).toBe(true);
    const remaining = await withTenant(f.shopId, trx => trx.raw(`SELECT count(*)::integer AS count
      FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 2
      AND classid::bigint = (hashtext(?)::bigint + 4294967296) % 4294967296
      AND objid::bigint = ?`, ['shopify_admin_credential_rotation', f.shopId]));
    expect(remaining.rows[0].count).toBe(0);
  });

  it('R3B-G: claim stores a random UUID, exact 30-second lease and captures generation N', async () => {
    const f = await fixture({ access_expires_at: seconds(60) });
    const before = await row(f);
    const uuid = jest.spyOn(crypto, 'randomUUID');
    const bytes = jest.spyOn(crypto, 'randomBytes');
    let result: Resolution;
    let randomUsed = false;
    try {
      result = await claim(f);
      randomUsed = uuid.mock.calls.length > 0 || bytes.mock.calls.length > 0;
    } finally { uuid.mockRestore(); bytes.mockRestore(); }
    expect(result!.kind).toBe('ROTATION_CLAIMED');
    expect(randomUsed).toBe(true);
    const after = await row(f);
    expect(after.rotation_lease_token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(new Date(after.rotation_lease_expires_at).getTime()).toBe(NOW.getTime() + 30000);
    expect(new Date(after.rotation_started_at).getTime()).toBe(NOW.getTime());
    expect(result!.leaseToken).toBe(after.rotation_lease_token);
    expect(String(result!.generation)).toBe(GENERATION);
    expect(result!.refreshTokenEncrypted === before.refresh_token_encrypted).toBe(true);
    expectClaimUnchangedMaterial(before, after);
  });

  it('R3B-H: live foreign lease with valid due access returns existing access unchanged', async () => {
    const f = await fixture({ access_expires_at: seconds(60), rotation_lease_token: LIVE_LEASE,
      rotation_lease_expires_at: seconds(10), rotation_started_at: seconds(-20) });
    const before = await row(f);
    const result = await resolve(f);
    expect(result.kind).toBe('READY');
    expect(result.accessToken === ACCESS).toBe(true);
    expect(await row(f)).toEqual(before);
  });

  it('R3B-I: live foreign lease with expired access returns REFRESH_IN_PROGRESS unchanged', async () => {
    const f = await fixture({ access_expires_at: NOW, rotation_lease_token: LIVE_LEASE,
      rotation_lease_expires_at: seconds(10), rotation_started_at: seconds(-20) });
    const before = await row(f);
    const result = await resolve(f);
    expect(result.kind).toBe('REFRESH_IN_PROGRESS');
    expectNoUsableToken(result);
    expect(await row(f)).toEqual(before);
  });

  it('CORRECTIVE-1: expired local refresh authority wins over a live foreign lease', async () => {
    const f = await fixture({ credential_state: 'ACTIVE', access_expires_at: NOW,
      refresh_expires_at: NOW, rotation_lease_token: LIVE_LEASE,
      rotation_lease_expires_at: seconds(10), rotation_started_at: seconds(-20) });
    const before = await row(f);
    expect(before.refresh_token_encrypted !== null).toBe(true);
    const result = await resolve(f);
    expect(result.kind).not.toBe('READY');
    expectNoUsableToken(result);
    // Full row equality proves the live lease, generation, state and material stay intact.
    expect(await row(f)).toEqual(before);
    expect(result.leaseToken).toBeUndefined();
    expect(result.kind).toBe('REAUTH_REQUIRED');
  });

  it('R3B-J: lease expiring exactly now is reclaimed without generation change', async () => {
    const f = await fixture({ access_expires_at: NOW, rotation_lease_token: LIVE_LEASE,
      rotation_lease_expires_at: NOW, rotation_started_at: seconds(-30) });
    const before = await row(f);
    const result = await claim(f);
    expect(result.kind).toBe('ROTATION_CLAIMED');
    const after = await row(f);
    expect(after.rotation_lease_token).not.toBe(LIVE_LEASE);
    expect(after.rotation_lease_token).toBe(result.leaseToken);
    expect(new Date(after.rotation_lease_expires_at).getTime()).toBe(NOW.getTime() + 30000);
    expect(new Date(after.rotation_started_at).getTime()).toBe(NOW.getTime());
    expectClaimUnchangedMaterial(before, after);
  });
});
