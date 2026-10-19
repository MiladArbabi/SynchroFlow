/**
 * GH-1068 / T3-A Slice 3B — real reconnect executor integration.
 *
 * Real PostgreSQL principals only: sf_app (runtime), the provisioned executor
 * E (sf_shopify_reconnect_executor) and finalizer owner O
 * (sf_shopify_reconnect_owner). No provider, executor or database mocks. The
 * migration role is used only for read-only observation, the authoritative
 * 0215 postcondition check, and one disposable fault-injection trigger.
 */

import crypto from 'crypto';
import pg from 'pg';
import knexFactory, { type Knex } from 'knex';
import db, { systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { decrypt, encrypt } from 'api-src/security/encryption.service';
import {
  assertShopifyReconnectExecutorReady,
  closeShopifyReconnectExecutor,
  executeShopifyReconnectFinalizer,
} from 'api-src/services/shopify/shopifyReconnectExecutor.db';
import {
  lockShopifyAdminCredentialRotation,
  persistShopifyAdminCredentials,
} from 'api-src/services/shopify/shopifyAdminCredential.repository';
import {
  finalizeShopifyAdminCredentialReconnect,
  prepareShopifyAdminCredentialReconnect,
  settleShopifyAdminCredentialReconnect,
  type ShopifyAdminCredentialReconnectPrepared,
} from 'api-src/services/shopify/shopifyAdminCredentialLifecycle.service';
import { updateIntegrationStatus } from 'api-src/services/shopify/shopifyIntegrationStatus.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
// GH-1068 T3-B / GH-1101: the latest evolution (0217) carries every 0215/0216 invariant.
import { assertSecurityPostconditions, FINALIZER_SIGNATURE } from
  '../../../apps/backend/migrations/20261019120000_0217_shopify_manual_recovery';

const E = 'sf_shopify_reconnect_executor';
const O = 'sf_shopify_reconnect_owner';
const LOCK_NAMESPACE = 'shopify_admin_credential_rotation';
const DEADLINE_MS = 10_000;
const REJECTED = 'SHOPIFY_RECONNECT_EXECUTOR_REJECTED';
const FINALIZE_SQL = `SELECT * FROM shopify_reconnect_private.finalize_reconnect(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;

type Fixture = { shopId: number; domain: string; installationId: number; integrationId?: number };
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

let observer: Knex | undefined;
let admin: Knex | undefined;

function disposableDb(): string {
  const database = process.env.PGDATABASE ?? '';
  if (process.env.NODE_ENV !== 'test' || process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1'
    || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(database) || process.env.PGUSER !== 'sf_app'
    || !process.env.PGMIGRATION_USER || process.env.PGMIGRATION_USER === 'sf_app') {
    throw new Error('GH1068_EXECUTOR_REFUSING_UNSAFE_DB');
  }
  return database;
}

function connection(database: string, options?: string) {
  return {
    host: process.env.PGHOST, port: Number(process.env.PGPORT), database,
    user: process.env.PGMIGRATION_USER, password: String(process.env.PGMIGRATION_PASSWORD || ''),
    connectionTimeoutMillis: 3_000, ...(options ? { options } : {}),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
}

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => { if (timer) clearTimeout(timer); });
}

function credentials(f: Fixture, label: string, gid = `gid://shopify/Shop/${f.shopId}`) {
  const now = Date.now();
  return {
    accessToken: `executor-access-${label}`,
    refreshToken: `executor-refresh-${label}`,
    accessExpiresAt: new Date(now + 86_400_000),
    refreshExpiresAt: new Date(now + 604_800_000),
    grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    shopIdentity: { gid, currencyCode: 'EUR', name: null, contactEmail: null, ianaTimezone: null },
  };
}

/** Domain labels obey the ratified lowercase hostname contract (no '_'). */
async function fixture(label: string, options: { integration?: boolean } = {}): Promise<Fixture> {
  const suffix = `${label}-${crypto.randomUUID()}`;
  const domain = `${suffix}.myshopify.com`;
  const shopId = await systemTransaction(trx => createTenantShop(trx, suffix));
  return withTenant(shopId, async trx => {
    let integrationId: number | undefined;
    if (options.integration !== false) {
      const [integration] = await trx('integrations').insert({
        shop_id: shopId, platform: 'shopify', platform_shop_name: domain,
      }).returning('id');
      integrationId = Number(integration.id);
    }
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId, shop_domain: domain, shop_gid: `gid://shopify/Shop/${shopId}`,
      scopes: SHOPIFY_REQUIRED_SCOPE_STRING, uninstalled_at: null,
    }).returning('id');
    const now = Date.now();
    await persistShopifyAdminCredentials(trx, Number(installation.id), shopId, {
      accessToken: `old-access-${suffix}`, refreshToken: `old-refresh-${suffix}`,
      accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    });
    return { shopId, domain, installationId: Number(installation.id), integrationId };
  });
}

async function prepare(f: Fixture): Promise<ShopifyAdminCredentialReconnectPrepared> {
  const prepared = await prepareShopifyAdminCredentialReconnect({
    shopId: f.shopId, shopDomain: f.domain, now: new Date(),
  });
  if (prepared.kind !== 'RECONNECT_PREPARED') throw new Error(`EXECUTOR_FIXTURE_NOT_PREPARED:${prepared.kind}`);
  return prepared;
}

/** Complete tenant-scoped authority snapshot (shops, installation, credential, integration). */
async function snapshot(shopId: number) {
  return withTenant(shopId, async trx => ({
    shop: await trx('shops').where({ id: shopId }).first('id', 'base_currency', 'timezone'),
    installations: await trx('shopify_app_installations').where({ shop_id: shopId }).select('*').orderBy('id'),
    credentials: await trx('shopify_admin_credentials').where({ shop_id: shopId }).select('*').orderBy('id'),
    integrations: await trx('integrations').where({ shop_id: shopId }).select('*').orderBy('id'),
  }));
}

async function integration(shopId: number) {
  return withTenant(shopId, trx => trx('integrations').where({ shop_id: shopId, platform: 'shopify' })
    .first('id', 'platform_shop_name', 'sync_status', 'sync_progress_current',
      'sync_progress_total', 'sync_last_error'));
}

async function credential(shopId: number) {
  return withTenant(shopId, trx => trx('shopify_admin_credentials').where({ shop_id: shopId }).first());
}

/** Raw E session; asserts the authenticated principal before use. */
async function executorClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.SHOPIFY_RECONNECT_DATABASE_URL });
  await client.connect();
  expect((await client.query('SELECT session_user::text AS s, current_user::text AS c')).rows[0])
    .toEqual({ s: E, c: E });
  return client;
}

function finalizeArgs(f: Fixture, prepared: ShopifyAdminCredentialReconnectPrepared, gid: string) {
  const c = credentials(f, 'raw', gid);
  return [prepared.shopId, prepared.installationId, prepared.shopDomain, prepared.installationState,
    prepared.generation, prepared.leaseToken, encrypt(c.accessToken), encrypt(c.refreshToken),
    c.accessExpiresAt, c.refreshExpiresAt, c.grantedScopes, gid, 'EUR', null];
}

async function rawFinalizeError(args: unknown[]) {
  const client = await executorClient();
  try {
    await client.query('BEGIN');
    await client.query(FINALIZE_SQL, args);
    throw new Error('FINALIZER_UNEXPECTEDLY_SUCCEEDED');
  } catch (error) {
    return error as pg.DatabaseError;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

async function sqlState(client: pg.Client, sql: string): Promise<string | undefined> {
  try {
    await client.query(sql);
    return undefined;
  } catch (error) {
    return (error as pg.DatabaseError).code;
  }
}

async function waitForExecutorWaiters(shopId: number, holderPid: number, count: number) {
  if (!observer) throw new Error('GH1068_EXECUTOR_OBSERVER_MISSING');
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const result = await observer.raw(`
      SELECT lock.pid, lock.granted, activity.usename, activity.wait_event_type,
             pg_blocking_pids(lock.pid) AS blockers
        FROM pg_locks AS lock JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
       WHERE lock.locktype = 'advisory' AND lock.mode = 'ExclusiveLock'
         AND lock.database = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND lock.objsubid = 2
         AND lock.classid::bigint = (hashtext(?)::bigint + 4294967296) % 4294967296
         AND lock.objid::bigint = ?`, [LOCK_NAMESPACE, shopId]);
    const holder = result.rows.filter((row: any) => row.granted);
    const waiters = result.rows.filter((row: any) => !row.granted);
    if (holder.length !== 1 || Number(holder[0].pid) !== holderPid) {
      throw new Error('CANONICAL_LOCK_HOLDER_NOT_VISIBLE');
    }
    if (waiters.length > count) throw new Error('UNEXPECTED_CANONICAL_LOCK_WAITER');
    if (waiters.length === count) return { holder: holder[0], waiters };
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('EXECUTOR_LOCK_WAITERS_NOT_OBSERVED');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ||= 'gh1068-executor-regression-encryption-key-2026';
  const database = disposableDb();
  observer = knexFactory({ client: 'pg', pool: { min: 0, max: 1 },
    connection: connection(database, '-c default_transaction_read_only=on -c statement_timeout=2000') });
  admin = knexFactory({ client: 'pg', pool: { min: 0, max: 1 }, connection: connection(database) });
  const identity = await observer.raw(`SELECT current_database() AS database,
    current_setting('transaction_read_only') AS read_only`);
  expect(identity.rows).toEqual([{ database, read_only: 'on' }]);
});

afterAll(async () => {
  const results = await Promise.allSettled([observer?.destroy(), admin?.destroy(),
    db.destroy(), closeShopifyReconnectExecutor()]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
});

describe('GH-1068 T3-A — real reconnect executor', () => {
  it('provisioned principals keep the 0215 authority boundary', async () => {
    // Authoritative current (0216) postconditions, evaluated by the migration's own SQL.
    await expect(assertSecurityPostconditions(admin!)).resolves.toBeUndefined();
    const finalizer = await observer!.raw(`
      SELECT p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
             ARRAY(SELECT pg_get_userbyid(a.grantee) || ':' || a.privilege_type || ':' || a.is_grantable
                     FROM aclexplode(p.proacl) a ORDER BY 1) AS acl
        FROM pg_proc p WHERE p.oid = to_regprocedure(?)`, [FINALIZER_SIGNATURE]);
    expect(finalizer.rows).toEqual([{ prosecdef: true, owner: O,
      acl: [`${E}:EXECUTE:false`, `${O}:EXECUTE:false`] }]);

    const e = await executorClient();
    try {
      expect(await sqlState(e, `SET ROLE ${O}`)).toBe('42501');
      expect(await sqlState(e, `INSERT INTO public.integrations (shop_id, platform) VALUES (1, 'shopify')`)).toBe('42501');
      expect(await sqlState(e, `UPDATE public.shopify_admin_credentials SET credential_state = 'ACTIVE'`)).toBe('42501');
      expect(await sqlState(e, `ALTER FUNCTION ${FINALIZER_SIGNATURE} SECURITY INVOKER`)).toBe('42501');
      expect(await sqlState(e, `CREATE FUNCTION shopify_reconnect_private.gh1068_probe() RETURNS int
        LANGUAGE sql AS 'SELECT 1'`)).toBe('42501');
      expect(await sqlState(e, `CREATE OR REPLACE FUNCTION public.enforce_sync_status_transition()
        RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`)).toBe('42501');
    } finally { await e.end(); }

    const f = await fixture('sf-app-denied');
    const prepared = await prepare(f);
    const before = await snapshot(f.shopId);
    const denied = await withTenant(f.shopId, trx => trx.raw(FINALIZE_SQL.replace(/\$(\d+)/g, '?'),
      finalizeArgs(f, prepared, `gid://shopify/Shop/${f.shopId}`))).then(() => undefined, error => error.code);
    expect(denied).toBe('42501');
    expect(await snapshot(f.shopId)).toEqual(before);
  });

  it('readiness attests the real executor principal and fails closed for invalid identities', async () => {
    await expect(assertShopifyReconnectExecutorReady()).resolves.toBeUndefined();
    const valid = process.env.SHOPIFY_RECONNECT_DATABASE_URL!;
    const wrongPassword = new URL(valid); wrongPassword.password = 'not-the-provisioned-executor-password';
    const runtimeRole = new URL(valid); runtimeRole.username = 'sf_app'; runtimeRole.password = process.env.PGPASSWORD!;
    for (const url of [wrongPassword.toString(), runtimeRole.toString(), '']) {
      let isolated!: typeof import('api-src/services/shopify/shopifyReconnectExecutor.db');
      jest.isolateModules(() => { isolated = require('api-src/services/shopify/shopifyReconnectExecutor.db'); });
      process.env.SHOPIFY_RECONNECT_DATABASE_URL = url;
      try {
        await expect(isolated.assertShopifyReconnectExecutorReady()).rejects.toThrow(REJECTED);
      } finally {
        process.env.SHOPIFY_RECONNECT_DATABASE_URL = valid;
        await isolated.closeShopifyReconnectExecutor();
      }
    }
  });

  it('E finalization atomically activates the fenced generation and resets to PENDING/0/0/NULL', async () => {
    const f = await fixture('finalize-completed');
    const authority = { installationId: f.installationId, shopDomain: f.domain,
      generation: String((await credential(f.shopId)).credential_generation) };
    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETED'] as const) {
      await updateIntegrationStatus({ integrationId: f.integrationId!, shopId: f.shopId, status,
        executionAuthority: authority, progressCurrent: 5, progressTotal: 5,
        error: status === 'COMPLETED' ? 'historical-error' : null });
    }
    const prepared = await prepare(f);
    const result = await finalizeShopifyAdminCredentialReconnect({
      ...prepared, credentials: credentials(f, 'finalize-completed') });
    expect(result).toEqual({ kind: 'RECONNECTED', generation: prepared.generation,
      integration: { id: f.integrationId } });
    // COMPLETED -> PENDING is only legal for O acting for an E session.
    expect(await integration(f.shopId)).toEqual({ id: f.integrationId, platform_shop_name: f.domain,
      sync_status: 'PENDING', sync_progress_current: 0, sync_progress_total: 0, sync_last_error: null });
    const active = await credential(f.shopId);
    expect(active).toMatchObject({ credential_state: 'ACTIVE', rotation_lease_token: null,
      rotation_lease_expires_at: null, rotation_started_at: null });
    expect(String(active.credential_generation)).toBe(prepared.generation);
    expect(decrypt(active.access_token_encrypted, 'shopify.dev')).toBe('executor-access-finalize-completed');

    // Stale writer: the predecessor generation can no longer report sync status.
    await expect(updateIntegrationStatus({ integrationId: f.integrationId!, shopId: f.shopId,
      status: 'SYNCING_PRODUCTS', executionAuthority: authority, progressCurrent: 1, progressTotal: 1 }))
      .rejects.toThrow('SHOPIFY_SYNC_STALE_AUTHORITY');
    expect((await integration(f.shopId)).sync_status).toBe('PENDING');
    await updateIntegrationStatus({ integrationId: f.integrationId!, shopId: f.shopId,
      status: 'SYNCING_PRODUCTS', progressCurrent: 0, progressTotal: 3,
      executionAuthority: { ...authority, generation: prepared.generation } });
    expect((await integration(f.shopId)).sync_status).toBe('SYNCING_PRODUCTS');
  });

  it('a superseded generation/lease is classified only by explicit PZ101 and changes nothing', async () => {
    const f = await fixture('superseded-owner');
    const superseded = await prepare(f);
    await settleShopifyAdminCredentialReconnect({ ...superseded, outcome: { kind: 'DEFINITIVE_NO_ISSUANCE' } });
    const current = await prepare(f);
    expect(BigInt(current.generation)).toBeGreaterThan(BigInt(superseded.generation));
    const before = await snapshot(f.shopId);

    const raw = await rawFinalizeError(finalizeArgs(f, superseded, `gid://shopify/Shop/${f.shopId}`));
    expect(raw).toBeInstanceOf(pg.DatabaseError);
    expect({ code: raw.code, message: raw.message })
      .toEqual({ code: 'PZ101', message: 'SHOPIFY_RECONNECT_STALE_OWNER' });
    await expect(executeShopifyReconnectFinalizer(superseded, credentials(f, 'superseded')))
      .resolves.toEqual({ kind: 'STALE_RESULT' });
    expect((await finalizeShopifyAdminCredentialReconnect({ ...superseded,
      credentials: credentials(f, 'superseded') })).kind).toBe('STALE_RESULT');
    expect(await snapshot(f.shopId)).toEqual(before);

    await expect(finalizeShopifyAdminCredentialReconnect({ ...current,
      credentials: credentials(f, 'current') })).resolves.toMatchObject({ kind: 'RECONNECTED',
      generation: current.generation });
  });

  it('generic finalizer failures stay fail-closed and are never classified as stale', async () => {
    const f = await fixture('generic-failure');
    const prepared = await prepare(f);
    const before = await snapshot(f.shopId);
    const invalidGid = 'gid://shopify/Shop/not-numeric';

    const raw = await rawFinalizeError(finalizeArgs(f, prepared, invalidGid));
    expect({ code: raw.code, message: raw.message })
      .toEqual({ code: 'P0001', message: 'SHOPIFY_RECONNECT_FINALIZATION_REJECTED' });
    await expect(executeShopifyReconnectFinalizer(prepared, credentials(f, 'generic', invalidGid)))
      .rejects.toThrow(REJECTED);
    await expect(finalizeShopifyAdminCredentialReconnect({ ...prepared,
      credentials: credentials(f, 'generic', invalidGid) })).rejects.toThrow(REJECTED);
    expect(await snapshot(f.shopId)).toEqual(before);
    expect((await credential(f.shopId)).rotation_lease_token).toBe(prepared.leaseToken);
  });

  it('a real database fault after credential activation rolls back every finalizer write', async () => {
    const f = await fixture('database-fault');
    const prepared = await prepare(f);
    const before = await snapshot(f.shopId);
    const trigger = `gh1068_executor_fault_${f.shopId}`;
    await admin!.raw(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_FAULT_AFTER_CREDENTIAL_ACTIVATION'; END $$`);
    try {
      await admin!.raw(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON public.integrations FOR EACH ROW
        WHEN (OLD.shop_id = ${f.shopId}) EXECUTE FUNCTION public.${trigger}()`);
      await expect(finalizeShopifyAdminCredentialReconnect({ ...prepared,
        credentials: credentials(f, 'database-fault') })).rejects.toThrow(REJECTED);
    } finally {
      await admin!.raw(`DROP TRIGGER IF EXISTS ${trigger} ON public.integrations;
        DROP FUNCTION IF EXISTS public.${trigger}()`);
    }
    expect(await snapshot(f.shopId)).toEqual(before);
    // The destroyed client left no poisoned transaction: the same owner can still finalize.
    await expect(finalizeShopifyAdminCredentialReconnect({ ...prepared,
      credentials: credentials(f, 'after-fault') })).resolves.toMatchObject({ kind: 'RECONNECTED' });
  });

  it('E finalizers queue on the canonical T2 lock and exactly one fenced owner wins', async () => {
    const f = await fixture('lock-contention');
    const prepared = await prepare(f);
    const ready = deferred();
    const release = deferred();
    let holderPid = 0;
    const holder = settle(withTenant(f.shopId, async trx => {
      await lockShopifyAdminCredentialRotation(trx, f.shopId);
      holderPid = Number((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      ready.resolve();
      await release.promise;
    }));
    let contenders: Promise<Outcome<Awaited<ReturnType<typeof finalizeShopifyAdminCredentialReconnect>>>>[] = [];
    try {
      await timeout(ready.promise, 'canonical lock holder did not start');
      contenders = ['contender-a', 'contender-b'].map(label => settle(
        finalizeShopifyAdminCredentialReconnect({ ...prepared, credentials: credentials(f, label) })));
      const overlap = await waitForExecutorWaiters(f.shopId, holderPid, 2);
      expect(overlap.holder.usename).toBe('sf_app');
      for (const waiter of overlap.waiters) {
        expect(waiter.usename).toBe(E);
        // wait_event_type is sampled apart from pg_locks (may still be null); the
        // ungranted row plus pg_blocking_pids is the contention proof.
        expect(waiter.blockers.map(Number)).toContain(holderPid);
      }
      release.resolve();
      const outcomes = await timeout(Promise.all(contenders), 'contending finalizers did not settle');
      expect(outcomes.every(outcome => outcome.ok)).toBe(true);
      const kinds = outcomes.map(outcome => (outcome as { value: { kind: string } }).value.kind).sort();
      expect(kinds).toEqual(['RECONNECTED', 'STALE_RESULT']);
      const winner = outcomes.findIndex(outcome => (outcome as any).value.kind === 'RECONNECTED');
      const active = await credential(f.shopId);
      expect(decrypt(active.access_token_encrypted, 'shopify.dev'))
        .toBe(`executor-access-contender-${winner === 0 ? 'a' : 'b'}`);
      expect(String(active.credential_generation)).toBe(prepared.generation);
      expect(await integration(f.shopId)).toMatchObject({ sync_status: 'PENDING',
        sync_progress_current: 0, sync_progress_total: 0, sync_last_error: null });
    } finally {
      release.resolve();
      expect((await timeout(holder, 'canonical lock holder cleanup')).ok).toBe(true);
      await timeout(Promise.all(contenders), 'contender cleanup');
    }
  }, 30_000);

  it('first-install (no integration) and reinstall (UNINSTALLED) finalize compatibly', async () => {
    const first = await fixture('first-install', { integration: false });
    const firstPrepared = await prepare(first);
    const created = await finalizeShopifyAdminCredentialReconnect({ ...firstPrepared,
      credentials: credentials(first, 'first-install') });
    expect(created.kind).toBe('RECONNECTED');
    const inserted = await integration(first.shopId);
    expect(inserted).toEqual({ id: (created as { integration: { id: number } }).integration.id,
      platform_shop_name: first.domain, sync_status: 'PENDING', sync_progress_current: 0,
      sync_progress_total: 0, sync_last_error: null });

    const reinstall = await fixture('reinstall');
    await withTenant(reinstall.shopId, trx => trx('shopify_app_installations')
      .where({ id: reinstall.installationId, shop_id: reinstall.shopId })
      .update({ uninstalled_at: new Date() }));
    const reinstallPrepared = await prepare(reinstall);
    expect(reinstallPrepared).toMatchObject({ mode: 'REINSTALL', installationState: 'UNINSTALLED' });
    await expect(finalizeShopifyAdminCredentialReconnect({ ...reinstallPrepared,
      credentials: credentials(reinstall, 'reinstall') })).resolves.toMatchObject({ kind: 'RECONNECTED' });
    const installation = await withTenant(reinstall.shopId, trx => trx('shopify_app_installations')
      .where({ id: reinstall.installationId }).first('uninstalled_at', 'shop_gid'));
    expect(installation).toEqual({ uninstalled_at: null, shop_gid: `gid://shopify/Shop/${reinstall.shopId}` });
    expect((await credential(reinstall.shopId)).credential_state).toBe('ACTIVE');
  });

  it('cross-tenant owner input is stale and never mutates either tenant', async () => {
    const a = await fixture('tenant-a');
    const b = await fixture('tenant-b');
    const preparedA = await prepare(a);
    const preparedB = await prepare(b);
    const beforeA = await snapshot(a.shopId);
    const beforeB = await snapshot(b.shopId);
    await expect(executeShopifyReconnectFinalizer({ ...preparedA, shopId: b.shopId },
      credentials(b, 'cross-tenant'))).resolves.toEqual({ kind: 'STALE_RESULT' });
    await expect(executeShopifyReconnectFinalizer({ ...preparedB, installationId: a.installationId },
      credentials(b, 'cross-installation'))).resolves.toEqual({ kind: 'STALE_RESULT' });
    expect(await snapshot(a.shopId)).toEqual(beforeA);
    expect(await snapshot(b.shopId)).toEqual(beforeB);

    await expect(finalizeShopifyAdminCredentialReconnect({ ...preparedA,
      credentials: credentials(a, 'tenant-a') })).resolves.toMatchObject({ kind: 'RECONNECTED' });
    expect(await snapshot(b.shopId)).toEqual(beforeB);
  });

  // Must remain last: closing is permanent for this module instance.
  it('closing the executor ends every E session and leaves no sf_app fallback', async () => {
    await assertShopifyReconnectExecutorReady();
    const f = await fixture('closed-executor');
    const prepared = await prepare(f);
    const before = await snapshot(f.shopId);
    await closeShopifyReconnectExecutor();
    // Backend exit after a client Terminate is asynchronous; bounded observation only.
    let remaining = -1;
    for (const deadline = Date.now() + 2_000; Date.now() < deadline;) {
      remaining = (await observer!.raw(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND usename = ?
          AND application_name = 'shopify-reconnect-executor'`, [E])).rows[0].count;
      if (remaining === 0) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(remaining).toBe(0);
    await expect(assertShopifyReconnectExecutorReady()).rejects.toThrow(REJECTED);
    await expect(finalizeShopifyAdminCredentialReconnect({ ...prepared,
      credentials: credentials(f, 'closed') })).rejects.toThrow(REJECTED);
    expect(await snapshot(f.shopId)).toEqual(before);
    await expect(closeShopifyReconnectExecutor()).resolves.toBeUndefined();
  });
});
