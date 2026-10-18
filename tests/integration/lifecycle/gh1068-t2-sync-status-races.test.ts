import crypto from 'crypto';
import pg from 'pg';
import { encrypt } from 'api-src/security/encryption.service';
import { closeShopifyReconnectExecutor } from 'api-src/services/shopify/shopifyReconnectExecutor.db';
import knexFactory, { type Knex } from 'knex';
import db, { systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { ShopifyAppService } from '@lasyncro/backend-core/services/shopify-app.service.js';
import { updateIntegrationStatus, type ShopifySyncExecutionAuthority } from
  'api-src/services/shopify/shopifyIntegrationStatus.service';
import { prepareShopifyAdminCredentialReconnect } from
  'api-src/services/shopify/shopifyAdminCredentialLifecycle.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from
  'api-src/services/shopify/shopifyScopes';
import { seedOfflineShopifySyncAuthority } from './shopify-sync-authority.fixture';

const LOCK_NAMESPACE = 'shopify_admin_credential_rotation';
const DEADLINE_MS = 10_000;
let observer: Knex | undefined;

type Fixture = {
  shopId: number;
  domain: string;
  integrationId: number;
  authority: ShopifySyncExecutionAuthority;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

function disposableDb(): string {
  const database = process.env.PGDATABASE ?? '';
  if (process.env.NODE_ENV !== 'test' || process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1'
    || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(database) || process.env.PGUSER !== 'sf_app') {
    throw new Error('GH1068_T2_REFUSING_UNSAFE_DB');
  }
  return database;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error }),
  );
}

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function fixture(label: string): Promise<Fixture> {
  const suffix = `${label}-${crypto.randomUUID()}`;
  const domain = `${suffix}.myshopify.com`;
  const shopId = await systemTransaction(trx => createTenantShop(trx, suffix));
  const [integration] = await withTenant(shopId, trx => trx('integrations').insert({
    shop_id: shopId,
    platform: 'shopify',
    platform_shop_name: domain,
  }).returning('id'));
  const authority = await seedOfflineShopifySyncAuthority(shopId, domain);
  return { shopId, domain, integrationId: Number(integration.id), authority };
}

async function integrationState(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const integration = await trx('integrations')
      .where({ id: f.integrationId, shop_id: f.shopId })
      .first('sync_status', 'sync_progress_current', 'sync_progress_total', 'sync_last_error');
    const [{ count: eventCount }] = await trx('domain_events')
      .where({ shop_id: f.shopId, event_type: 'integration/sync_completed' })
      .count<{ count: string }[]>('* as count');
    const [{ count: outboxCount }] = await trx('domain_event_outbox as outbox')
      .join('domain_events as event', 'event.id', 'outbox.domain_event_id')
      .where({
        'event.shop_id': f.shopId,
        'event.event_type': 'integration/sync_completed',
      })
      .count<{ count: string }[]>('* as count');
    return {
      status: integration.sync_status,
      progressCurrent: integration.sync_progress_current,
      progressTotal: integration.sync_progress_total,
      lastError: integration.sync_last_error,
      eventCount: Number(eventCount),
      outboxCount: Number(outboxCount),
    };
  });
}

async function authorityState(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const installation = await trx('shopify_app_installations')
      .where({ id: f.authority.installationId, shop_id: f.shopId })
      .first('uninstalled_at');
    const credential = await trx('shopify_admin_credentials')
      .where({ installation_id: f.authority.installationId, shop_id: f.shopId })
      .first('credential_state', 'credential_generation');
    return {
      uninstalledAt: installation.uninstalled_at,
      credentialState: credential.credential_state,
      generation: String(credential.credential_generation),
    };
  });
}

async function backendPid(trx: Knex.Transaction): Promise<number> {
  const result = await trx.raw('SELECT pg_backend_pid() AS pid');
  return Number(result.rows[0].pid);
}

async function waitForExactAuthorityWaiter(
  shopId: number,
  holderPid: number,
  waiterSettled: () => boolean,
): Promise<number> {
  if (!observer) throw new Error('GH1068_T2_LOCK_OBSERVER_MISSING');
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    if (waiterSettled()) {
      throw new Error('STATUS_WRITER_SETTLED_BEFORE_CONTENTION_PROOF');
    }
    const result = await observer.raw(`
      SELECT lock.pid, lock.granted, activity.usename, activity.state,
             activity.wait_event_type, pg_blocking_pids(lock.pid) AS blockers
        FROM pg_locks AS lock
        JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
       WHERE lock.locktype = 'advisory'
         AND lock.mode = 'ExclusiveLock'
         AND lock.database = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND lock.objsubid = 2
         AND lock.classid::bigint =
             (hashtext(?)::bigint + 4294967296) % 4294967296
         AND lock.objid::bigint = ?
    `, [LOCK_NAMESPACE, shopId]);
    const holder = result.rows.find((row: any) => row.granted);
    const waiters = result.rows.filter((row: any) => !row.granted);
    if (Number(holder?.pid) !== holderPid) {
      throw new Error('EXACT_AUTHORITY_LOCK_HOLDER_NOT_VISIBLE');
    }
    if (waiters.length > 1) throw new Error('UNEXPECTED_AUTHORITY_LOCK_WAITER');
    if (waiters.length === 1) {
      const waiter = waiters[0];
      expect(waiter.usename).toBe('sf_app');
      // pg_stat_activity session state (state, wait_event_type) is sampled apart
      // from the lock table: it can read 'idle in transaction' or a null wait
      // event while pg_locks already shows this ungranted request. The lock-manager
      // facts below (ungranted row, exact holder, blockers) are the contention proof.
      expect(waiter.blockers.map(Number)).toContain(holderPid);
      if (waiterSettled()) throw new Error('STATUS_WRITER_SETTLED_DURING_CONTENTION_PROOF');
      return Number(waiter.pid);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('EXACT_AUTHORITY_LOCK_WAITER_NOT_OBSERVED');
}

beforeAll(async () => {
  const database = disposableDb();
  if (!process.env.PGMIGRATION_USER || process.env.PGMIGRATION_USER === 'sf_app') {
    throw new Error('GH1068_T2_READ_ONLY_OBSERVER_ROLE_REQUIRED');
  }
  observer = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      database,
      user: process.env.PGMIGRATION_USER,
      password: String(process.env.PGMIGRATION_PASSWORD || ''),
      connectionTimeoutMillis: 2_000,
      options: '-c default_transaction_read_only=on -c statement_timeout=2000',
    },
    pool: { min: 0, max: 1 },
  });
  const identity = await observer.raw(`SELECT current_database() AS database,
    current_setting('transaction_read_only') AS read_only`);
  expect(identity.rows).toEqual([{ database, read_only: 'on' }]);
});

afterAll(async () => {
  const results = await Promise.allSettled([observer?.destroy(), db.destroy(), closeShopifyReconnectExecutor()]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
}, 10_000);

describe('GH-1068 T2 — sync status authority races', () => {
  it('uninstall wins over an old-generation status write already queued on its authority lock', async () => {
    const f = await fixture('uninstall-wins');
    await updateIntegrationStatus({
      integrationId: f.integrationId,
      shopId: f.shopId,
      status: 'SYNCING_PRODUCTS',
      progressCurrent: 3,
      progressTotal: 11,
      executionAuthority: f.authority,
    });
    const before = await integrationState(f);
    const uninstallReady = deferred();
    const releaseUninstall = deferred();
    let uninstallHolderPid = 0;
    let statusSettled = false;
    let uninstallOutcome: Outcome<void> | undefined;
    let statusOutcome: Outcome<void> | undefined;
    let status: Promise<Outcome<void>> | undefined;

    const uninstall = settle(withTenant(f.shopId, async trx => {
      await ShopifyAppService.hardFenceAppUninstalled(
        f.shopId, trx, new Date('2026-10-16T10:00:00.000Z'), f.domain,
      );
      uninstallHolderPid = await backendPid(trx);
      uninstallReady.resolve();
      await releaseUninstall.promise;
    }));

    try {
      await timeout(uninstallReady.promise, 'uninstall authority transaction did not reach gate');
      status = settle(updateIntegrationStatus({
        integrationId: f.integrationId,
        shopId: f.shopId,
        status: 'COMPLETED',
        progressCurrent: 11,
        progressTotal: 11,
        error: null,
        executionAuthority: f.authority,
      })).finally(() => { statusSettled = true; });
      await waitForExactAuthorityWaiter(f.shopId, uninstallHolderPid, () => statusSettled);
      releaseUninstall.resolve();
      [uninstallOutcome, statusOutcome] = await timeout(
        Promise.all([uninstall, status]), 'uninstall/status transactions did not settle',
      );
    } finally {
      releaseUninstall.resolve();
      uninstallOutcome ??= await timeout(uninstall, 'uninstall transaction cleanup');
      if (status) statusOutcome ??= await timeout(status, 'uninstall status-writer cleanup');
    }

    expect(uninstallOutcome).toEqual({ ok: true, value: undefined });
    expect(statusOutcome?.ok).toBe(false);
    expect((statusOutcome as { ok: false; error: Error }).error.message)
      .toBe('SHOPIFY_SYNC_STALE_AUTHORITY');
    expect(await integrationState(f)).toEqual(before);
  }, 30_000);

  it('reconnect wins over an old-generation status write queued behind canonical replacement', async () => {
    const f = await fixture('reconnect-wins');
    await updateIntegrationStatus({
      integrationId: f.integrationId,
      shopId: f.shopId,
      status: 'SYNCING_PRODUCTS',
      progressCurrent: 2,
      progressTotal: 9,
      executionAuthority: f.authority,
    });
    const before = await integrationState(f);
    const now = new Date('2026-10-16T11:00:00.000Z');
    const prepared = await prepareShopifyAdminCredentialReconnect({
      shopId: f.shopId,
      shopDomain: f.domain,
      now,
    });
    expect(prepared.kind).toBe('RECONNECT_PREPARED');
    if (prepared.kind !== 'RECONNECT_PREPARED') throw new Error('RECONNECT_NOT_PREPARED');
    expect(prepared.generation).not.toBe(f.authority.generation);

    const reconnectReady = deferred();
    const releaseReconnect = deferred();
    let reconnectHolderPid = 0;
    let statusSettled = false;
    let reconnectOutcome: Outcome<{ generation: string }> | undefined;
    let statusOutcome: Outcome<void> | undefined;
    let status: Promise<Outcome<void>> | undefined;

    const reconnect = settle((async () => {
      const client = new pg.Client({connectionString:process.env.SHOPIFY_RECONNECT_DATABASE_URL});
      try {
        await client.connect();
        expect((await client.query('SELECT session_user,current_user')).rows[0])
          .toEqual({session_user:'sf_shopify_reconnect_executor',current_user:'sf_shopify_reconnect_executor'});
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1),$2::integer)',[LOCK_NAMESPACE,f.shopId]);
        const result = await client.query(`SELECT * FROM shopify_reconnect_private.finalize_reconnect(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [f.shopId,f.authority.installationId,f.domain,prepared.installationState,prepared.generation,prepared.leaseToken,
            encrypt('reconnected-test-token'),encrypt('reconnected-test-refresh-token'),
            new Date(now.getTime()+86400000),new Date(now.getTime()+604800000),SHOPIFY_REQUIRED_SCOPE_STRING,
            `gid://shopify/Shop/${f.shopId}`,'USD',null]);
        expect(result.rows[0].generation).toBe(prepared.generation);
        reconnectHolderPid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        reconnectReady.resolve(); await releaseReconnect.promise;
        await client.query('COMMIT');
        return {generation:result.rows[0].generation};
      } finally { await client.end(); }
    })());

    try {
      await timeout(reconnectReady.promise, 'reconnect authority transaction did not reach gate');
      status = settle(updateIntegrationStatus({
        integrationId: f.integrationId,
        shopId: f.shopId,
        status: 'SYNCING_ORDERS',
        progressCurrent: 7,
        progressTotal: 9,
        executionAuthority: f.authority,
      })).finally(() => { statusSettled = true; });
      await waitForExactAuthorityWaiter(f.shopId, reconnectHolderPid, () => statusSettled);
      releaseReconnect.resolve();
      [reconnectOutcome, statusOutcome] = await timeout(
        Promise.all([reconnect, status]), 'reconnect/status transactions did not settle',
      );
    } finally {
      releaseReconnect.resolve();
      reconnectOutcome ??= await timeout(reconnect, 'reconnect transaction cleanup');
      if (status) statusOutcome ??= await timeout(status, 'reconnect status-writer cleanup');
    }

    expect(reconnectOutcome).toEqual({
      ok: true,
      value: { generation: prepared.generation },
    });
    expect(statusOutcome?.ok).toBe(false);
    expect((statusOutcome as { ok: false; error: Error }).error.message)
      .toBe('SHOPIFY_SYNC_STALE_AUTHORITY');
    // T3 contract: the winning reconnect starts a fresh cycle (PENDING/0/0/NULL);
    // the losing old-generation write (SYNCING_ORDERS/7/9) must not have landed.
    expect(await integrationState(f)).toEqual({
      ...before, status: 'PENDING', progressCurrent: 0, progressTotal: 0, lastError: null,
    });
    expect(await authorityState(f)).toEqual({
      uninstalledAt: null,
      credentialState: 'ACTIVE',
      generation: prepared.generation,
    });
  }, 30_000);

  it('current authority progresses legal status phases and owns one completion event/outbox pair', async () => {
    const f = await fixture('current-authority');
    expect((await integrationState(f)).status).toBe('PENDING');

    await updateIntegrationStatus({
      integrationId: f.integrationId,
      shopId: f.shopId,
      status: 'SYNCING_PRODUCTS',
      progressCurrent: 0,
      progressTotal: 6,
      executionAuthority: f.authority,
    });
    expect(await integrationState(f)).toMatchObject({
      status: 'SYNCING_PRODUCTS', progressCurrent: 0, progressTotal: 6,
      lastError: null, eventCount: 0, outboxCount: 0,
    });

    await updateIntegrationStatus({
      integrationId: f.integrationId,
      shopId: f.shopId,
      status: 'SYNCING_ORDERS',
      progressCurrent: 4,
      executionAuthority: f.authority,
    });
    expect(await integrationState(f)).toMatchObject({
      status: 'SYNCING_ORDERS', progressCurrent: 4, progressTotal: 6,
      lastError: null, eventCount: 0, outboxCount: 0,
    });

    await updateIntegrationStatus({
      integrationId: f.integrationId,
      shopId: f.shopId,
      status: 'COMPLETED',
      progressCurrent: 6,
      error: null,
      executionAuthority: f.authority,
    });
    expect(await integrationState(f)).toEqual({
      status: 'COMPLETED', progressCurrent: 6, progressTotal: 6,
      lastError: null, eventCount: 1, outboxCount: 1,
    });
  });
});
