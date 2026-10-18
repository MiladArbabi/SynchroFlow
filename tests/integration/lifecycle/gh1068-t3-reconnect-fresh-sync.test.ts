/**
 * GH-1068 / T3-A RED contract — successful Shopify reconnect starts a fresh
 * synchronization cycle in the same transaction as credential activation.
 *
 * Real PostgreSQL only. Provider access is replaced by an injected, fully
 * offline GraphQL client. Production source and shared fixtures remain intact.
 */

jest.mock('api-src/services/shopify/shopifyWebhook.service', () => ({
  registerWebhooksForShop: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('api-src/services/shopify/shopifyRefundBackfill.service', () => ({
  backfillShopifyRefunds: jest.fn().mockResolvedValue({ shopId: 0, refundsBackfilled: 0 }),
}));

import crypto from 'crypto';
import pg from 'pg';
import knexFactory, { type Knex } from 'knex';
import db, { systemQuery, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { decrypt, encrypt } from 'api-src/security/encryption.service';
import { closeShopifyReconnectExecutor } from 'api-src/services/shopify/shopifyReconnectExecutor.db';
import { performInitialSync } from 'api-src/services/shopify.service';
import {
  persistShopifyAdminCredentials,
  type ShopifyAdminCredentialRow,
} from 'api-src/services/shopify/shopifyAdminCredential.repository';
import {
  finalizeShopifyAdminCredentialReconnect,
  prepareShopifyAdminCredentialReconnect,
  settleShopifyAdminCredentialReconnect,
  type ShopifyAdminCredentialReconnectPrepared,
} from 'api-src/services/shopify/shopifyAdminCredentialLifecycle.service';
import { resolveShopifyAdminCredentialForConsumer } from
  'api-src/services/shopify/shopifyAdminCredentialConsumer.service';
import {
  updateIntegrationStatus,
  type ShopifySyncExecutionAuthority,
} from 'api-src/services/shopify/shopifyIntegrationStatus.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';

const LOCK_NAMESPACE = 'shopify_admin_credential_rotation';
const DEADLINE_MS = 10_000;
const NOW = new Date('2026-10-16T12:00:00.000Z');

type SyncStatus =
  | 'PENDING'
  | 'FAILED'
  | 'SYNCING_PRODUCTS'
  | 'SYNCING_ORDERS'
  | 'SYNCING_INVENTORY'
  | 'SYNCING_SHOP'
  | 'COMPLETING'
  | 'COMPLETED';

type Fixture = {
  shopId: number;
  domain: string;
  integrationId: number;
  installationId: number;
  authority: ShopifySyncExecutionAuthority;
};

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

let observer: Knex | undefined;

function disposableDb(): string {
  const database = process.env.PGDATABASE ?? '';
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' ||
    !/^synchroflow_test_[A-Za-z0-9_]+$/.test(database) ||
    process.env.PGUSER !== 'sf_app'
  ) {
    throw new Error('GH1068_T3_REFUSING_UNSAFE_DB');
  }
  return database;
}

function deferred() {
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

function acquiredCredentials(f: Fixture, label: string, currencyCode = 'USD') {
  return {
    accessToken: `t3-access-${label}`,
    refreshToken: `t3-refresh-${label}`,
    accessExpiresAt: new Date(NOW.getTime() + 86_400_000),
    refreshExpiresAt: new Date(NOW.getTime() + 604_800_000),
    grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    shopIdentity: {
      gid: `gid://shopify/Shop/${f.shopId}`,
      currencyCode,
      name: null,
      contactEmail: null,
      ianaTimezone: null,
    },
  };
}

async function fixture(label: string): Promise<Fixture> {
  const suffix = `${label}-${crypto.randomUUID()}`;
  const domain = `${suffix}.myshopify.com`;
  const shopId = await systemTransaction(trx => createTenantShop(trx, suffix));
  return withTenant(shopId, async trx => {
    const [integration] = await trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: domain,
    }).returning('id');
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: domain,
      shop_gid: `gid://shopify/Shop/${shopId}`,
      scopes: SHOPIFY_REQUIRED_SCOPE_STRING,
      uninstalled_at: null,
    }).returning('id');
    await persistShopifyAdminCredentials(trx, Number(installation.id), shopId, {
      accessToken: `old-access-${suffix}`,
      refreshToken: `old-refresh-${suffix}`,
      accessExpiresAt: new Date(NOW.getTime() + 86_400_000),
      refreshExpiresAt: new Date(NOW.getTime() + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    });
    const credential = await trx('shopify_admin_credentials')
      .where({ shop_id: shopId, installation_id: installation.id })
      .first('credential_generation');
    return {
      shopId,
      domain,
      integrationId: Number(integration.id),
      installationId: Number(installation.id),
      authority: {
        installationId: Number(installation.id),
        shopDomain: domain,
        generation: String(credential.credential_generation),
      },
    };
  });
}

async function integrationState(f: Fixture) {
  return withTenant(f.shopId, trx => trx('integrations')
    .where({ id: f.integrationId, shop_id: f.shopId })
    .first('id', 'sync_status', 'sync_progress_current', 'sync_progress_total', 'sync_last_error'));
}

async function credentialState(f: Fixture) {
  return withTenant(f.shopId, trx => trx<ShopifyAdminCredentialRow>('shopify_admin_credentials')
    .where({ shop_id: f.shopId, installation_id: f.installationId }).first());
}

async function writeStatus(
  f: Fixture,
  status: SyncStatus,
  authority = f.authority,
  progressCurrent = 7,
  progressTotal = 11,
  error: string | null = 'historical-error',
) {
  await updateIntegrationStatus({
    integrationId: f.integrationId,
    shopId: f.shopId,
    status,
    executionAuthority: authority,
    progressCurrent,
    progressTotal,
    error,
  });
}

async function transitionTo(f: Fixture, target: SyncStatus) {
  if (target === 'PENDING') {
    await writeStatus(f, 'PENDING');
    return;
  }
  await writeStatus(f, 'SYNCING_PRODUCTS');
  if (target === 'SYNCING_PRODUCTS') return;
  if (target === 'FAILED') {
    await writeStatus(f, 'FAILED');
    return;
  }
  if (target === 'SYNCING_ORDERS' || target === 'COMPLETED') {
    await writeStatus(f, 'SYNCING_ORDERS');
    if (target === 'COMPLETED') {
      await writeStatus(f, 'COMPLETED', f.authority, 11, 11, null);
      await writeStatus(f, 'COMPLETED', f.authority, 11, 11, 'historical-error');
    }
    return;
  }
  await writeStatus(f, 'SYNCING_INVENTORY');
  if (target === 'SYNCING_INVENTORY') return;
  await writeStatus(f, 'SYNCING_SHOP');
  if (target === 'SYNCING_SHOP') return;
  await writeStatus(f, 'COMPLETING');
}

async function prepare(f: Fixture): Promise<ShopifyAdminCredentialReconnectPrepared> {
  const prepared = await prepareShopifyAdminCredentialReconnect({
    shopId: f.shopId,
    shopDomain: f.domain,
    now: NOW,
  });
  expect(prepared.kind).toBe('RECONNECT_PREPARED');
  if (prepared.kind !== 'RECONNECT_PREPARED') throw new Error('T3_RECONNECT_NOT_PREPARED');
  return prepared;
}

async function reconnect(f: Fixture, label: string) {
  const prepared = await prepare(f);
  const result = await finalizeShopifyAdminCredentialReconnect({
    ...prepared,
    credentials: acquiredCredentials(f, label),
  });
  expect(result.kind).toBe('RECONNECTED');
  if (result.kind !== 'RECONNECTED') throw new Error('T3_RECONNECT_NOT_FINALIZED');
  return { prepared, result };
}

function expectFreshState(state: any, integrationId: number) {
  expect(state).toEqual({
    id: integrationId,
    sync_status: 'PENDING',
    sync_progress_current: 0,
    sync_progress_total: 0,
    sync_last_error: null,
  });
}

function makeEmptyStoreClient() {
  return {
    request: jest.fn(async (query: string) => {
      if (query.includes('orders(')) {
        return { data: { orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
      }
      return {
        data: {
          products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
          shop: { id: 'gid://shopify/Shop/offline', name: 'Offline', email: 'offline@example.test', currencyCode: 'USD' },
        },
      };
    }),
  };
}

async function backendPid(trx: Knex.Transaction): Promise<number> {
  const result = await trx.raw('SELECT pg_backend_pid() AS pid');
  return Number(result.rows[0].pid);
}

async function waitForExactAuthorityWaiter(
  shopId: number,
  holderPid: number,
  waiterSettled: () => boolean,
) {
  if (!observer) throw new Error('GH1068_T3_LOCK_OBSERVER_MISSING');
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    if (waiterSettled()) throw new Error('STATUS_WRITER_SETTLED_BEFORE_CONTENTION_PROOF');
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
    if (Number(holder?.pid) !== holderPid) throw new Error('EXACT_AUTHORITY_LOCK_HOLDER_NOT_VISIBLE');
    if (waiters.length > 1) throw new Error('UNEXPECTED_AUTHORITY_LOCK_WAITER');
    if (waiters.length === 1) {
      expect(waiters[0].usename).toBe('sf_app');
      // pg_stat_activity session state (state, wait_event_type) is sampled apart
      // from the lock table: it can read 'idle in transaction' or a null wait
      // event while pg_locks already shows this ungranted request. The lock-manager
      // facts below (ungranted row, exact holder, blockers) are the contention proof.
      expect(waiters[0].blockers.map(Number)).toContain(holderPid);
      if (waiterSettled()) throw new Error('STATUS_WRITER_SETTLED_DURING_CONTENTION_PROOF');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('EXACT_AUTHORITY_LOCK_WAITER_NOT_OBSERVED');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ||= 'gh1068-t3-regression-encryption-key-2026';
  const database = disposableDb();
  if (!process.env.PGMIGRATION_USER || process.env.PGMIGRATION_USER === 'sf_app') {
    throw new Error('GH1068_T3_READ_ONLY_OBSERVER_ROLE_REQUIRED');
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
});

describe('GH-1068 T3-A — reconnect fresh-sync RED contract', () => {
  it.each<SyncStatus>([
    'PENDING',
    'FAILED',
    'SYNCING_PRODUCTS',
    'SYNCING_ORDERS',
    'SYNCING_INVENTORY',
    'SYNCING_SHOP',
    'COMPLETING',
    'COMPLETED',
  ])('historical %s reconnect atomically activates a new generation in fresh PENDING state', async predecessor => {
    // Ratified domain contract: lowercase hostname labels never contain '_'.
    const f = await fixture(`matrix-${predecessor.toLowerCase().replace(/_/g, '-')}`);
    await transitionTo(f, predecessor);
    const integrationIdBefore = (await integrationState(f)).id;
    const generationBefore = (await credentialState(f))!.credential_generation;

    const { result } = await reconnect(f, `matrix-${predecessor}`);
    const state = await integrationState(f);
    const credential = await credentialState(f);

    expect(result.generation).toBe((BigInt(generationBefore) + 1n).toString());
    expect(credential?.credential_state).toBe('ACTIVE');
    expect(String(credential?.credential_generation)).toBe(result.generation);
    expect(integrationIdBefore).toBe(f.integrationId);
    expectFreshState(state, f.integrationId);
  });

  it('previously COMPLETED reconnect executes real initial-sync collection under the new authority', async () => {
    const f = await fixture('actual-fresh-execution');
    await transitionTo(f, 'COMPLETED');
    const { result } = await reconnect(f, 'actual-fresh-execution');
    const authority = await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW });
    expect(authority.kind).toBe('READY');
    if (authority.kind !== 'READY') throw new Error('T3_NEW_AUTHORITY_NOT_READY');
    expect(authority.generation).toBe(result.generation);

    await systemQuery(db('projection_cursors').insert({
      projection_name: 'orders_projection',
      last_processed_event_id: '9223372036854775807',
    }).onConflict('projection_name').ignore());

    const client = makeEmptyStoreClient();
    await performInitialSync(authority.accessToken, authority.shopDomain, f.shopId, f.integrationId, {
      shopifyClient: client,
      executionAuthority: authority,
    });

    expect(client.request).toHaveBeenCalled();
    expect(client.request.mock.calls.some(([query]) => String(query).includes('products('))).toBe(true);
    expect(client.request.mock.calls.some(([query]) => String(query).includes('orders('))).toBe(true);
    expect((await integrationState(f)).sync_status).toBe('COMPLETED');
  }, 60_000);

  it('definitive no-issuance preserves historical sync state and restores predecessor ACTIVE', async () => {
    const f = await fixture('definitive-no-issuance');
    await transitionTo(f, 'FAILED');
    const before = await integrationState(f);
    const prepared = await prepare(f);
    const result = await settleShopifyAdminCredentialReconnect({
      ...prepared,
      outcome: { kind: 'DEFINITIVE_NO_ISSUANCE' },
    });
    expect(result.kind).toBe('LEASE_RELEASED');
    expect(await integrationState(f)).toEqual(before);
    expect((await credentialState(f))?.credential_state).toBe('ACTIVE');
  });

  it('possibly-issued failure preserves historical sync state and remains fail-closed', async () => {
    const f = await fixture('possibly-issued');
    await transitionTo(f, 'SYNCING_ORDERS');
    const before = await integrationState(f);
    const prepared = await prepare(f);
    const result = await settleShopifyAdminCredentialReconnect({
      ...prepared,
      outcome: { kind: 'POSSIBLY_ISSUED' },
    });
    expect(result.kind).toBe('LEASE_RELEASED');
    expect(await integrationState(f)).toEqual(before);
    expect((await credentialState(f))?.credential_state).toBe('REAUTH_REQUIRED');
  });

  it('stale reconnect owner cannot activate credentials or reset historical sync state', async () => {
    const f = await fixture('stale-owner');
    await transitionTo(f, 'COMPLETING');
    const before = await integrationState(f);
    const prepared = await prepare(f);
    await settleShopifyAdminCredentialReconnect({
      ...prepared,
      outcome: { kind: 'DEFINITIVE_NO_ISSUANCE' },
    });
    const stale = await finalizeShopifyAdminCredentialReconnect({
      ...prepared,
      credentials: acquiredCredentials(f, 'stale-owner'),
    });
    expect(stale.kind).toBe('STALE_RESULT');
    expect(await integrationState(f)).toEqual(before);
    expect(decrypt((await credentialState(f))!.access_token_encrypted!,
      'shopify.adminCredential.lifecycle')).toContain('old-access-');
  });

  it('reconnect reset shares the T2 lock: old generation loses and new generation may start', async () => {
    const f = await fixture('t2-lock-non-regression');
    await transitionTo(f, 'SYNCING_PRODUCTS');
    const prepared = await prepare(f);
    const reconnectReady = deferred();
    const releaseReconnect = deferred();
    let holderPid = 0;
    let oldWriterSettled = false;

    const reconnectTransaction = settle((async () => {
      const client = new pg.Client({ connectionString: process.env.SHOPIFY_RECONNECT_DATABASE_URL });
      try {
        await client.connect();
        expect((await client.query('SELECT session_user,current_user')).rows[0])
          .toEqual({ session_user: 'sf_shopify_reconnect_executor', current_user: 'sf_shopify_reconnect_executor' });
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1),$2::integer)',[LOCK_NAMESPACE,f.shopId]);
        const credentials = acquiredCredentials(f, 't2-lock-non-regression');
        const result = await client.query(`SELECT * FROM shopify_reconnect_private.finalize_reconnect(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [f.shopId,f.installationId,f.domain,prepared.installationState,prepared.generation,prepared.leaseToken,
            encrypt(credentials.accessToken),encrypt(credentials.refreshToken),credentials.accessExpiresAt,
            credentials.refreshExpiresAt,credentials.grantedScopes,credentials.shopIdentity.gid,'USD',null]);
        expect(result.rows[0].generation).toBe(prepared.generation);
        holderPid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        reconnectReady.resolve();
        await releaseReconnect.promise;
        await client.query('COMMIT');
        return result.rows[0];
      } finally { await client.end(); }
    })());

    let oldWriter: Promise<Outcome<void>> | undefined;
    try {
      await timeout(reconnectReady.promise, 'reconnect transaction did not reach lock gate');
      oldWriter = settle(writeStatus(f, 'SYNCING_ORDERS')).finally(() => { oldWriterSettled = true; });
      await waitForExactAuthorityWaiter(f.shopId, holderPid, () => oldWriterSettled);
      releaseReconnect.resolve();
      const [reconnectOutcome, oldOutcome] = await timeout(
        Promise.all([reconnectTransaction, oldWriter]), 'reconnect/status transactions did not settle',
      );
      expect(reconnectOutcome.ok).toBe(true);
      expect(oldOutcome.ok).toBe(false);
      expect((oldOutcome as { ok: false; error: Error }).error.message)
        .toBe('SHOPIFY_SYNC_STALE_AUTHORITY');
    } finally {
      releaseReconnect.resolve();
      await timeout(reconnectTransaction, 'reconnect transaction cleanup');
      if (oldWriter) await timeout(oldWriter, 'old status-writer cleanup');
    }

    const postReconnectState = await integrationState(f);
    const ready = await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW });
    expect(ready.kind).toBe('READY');
    if (ready.kind !== 'READY') throw new Error('T3_CURRENT_AUTHORITY_NOT_READY');
    await writeStatus(f, 'SYNCING_PRODUCTS', {
      installationId: ready.installationId,
      shopDomain: ready.shopDomain,
      generation: ready.generation,
    }, 0, 0, null);
    expect((await integrationState(f)).sync_status).toBe('SYNCING_PRODUCTS');
    expectFreshState(postReconnectState, f.integrationId);
  }, 30_000);

  it('ordinary COMPLETED to PENDING remains forbidden outside authorized reconnect', async () => {
    const f = await fixture('ordinary-guard');
    await transitionTo(f, 'COMPLETED');
    await expect(writeStatus(f, 'PENDING', f.authority, 0, 0, null))
      .rejects.toThrow(/cannot regress after COMPLETED/);
    expect((await integrationState(f)).sync_status).toBe('COMPLETED');
  });

  it('successful reconnect preserves merchant identities and durable historical rows', async () => {
    const f = await fixture('preservation');
    await transitionTo(f, 'COMPLETED');
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const movementId = crypto.randomUUID();
    const historicalEventId = await withTenant(f.shopId, async trx => {
      await trx('products').insert({
        lasyncro_product_id: productId, shop_id: f.shopId,
        title: 'T3 preserved product', status: 'active', product_type: 'physical',
      });
      await trx('variants').insert({
        lasyncro_variant_id: variantId, lasyncro_product_id: productId,
        shop_id: f.shopId, title: 'T3 preserved variant', unit_cost: '5.00', status: 'active',
      });
      await trx('orders').insert({
        lasyncro_order_id: orderId, shop_id: f.shopId, currency: 'USD',
        total_price: 10, subtotal_price: 10, total_tax: 0,
        order_created_at: NOW, order_updated_at: NOW,
        created_at: NOW, updated_at: NOW,
      });
      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: movementId, shop_id: f.shopId,
        lasyncro_variant_id: variantId, movement_type: 'opening_balance', quantity_delta: 4,
        reference_type: 'opening_balance', reference_id: crypto.randomUUID(),
        platform: 'shopify', location_code: `WH-${f.shopId}-ROOT`, occurred_at: NOW,
      });
      const [event] = await trx('domain_events').insert({
        shop_id: f.shopId, event_type: 'orders/sync', event_payload: { id: 'historical-t3' },
        event_time: NOW, event_version: 1, external_event_id: `historical-t3-${f.shopId}`,
      }).returning('id');
      return Number(event.id);
    });

    await reconnect(f, 'preservation');
    const preserved = await withTenant(f.shopId, async trx => ({
      product: await trx('products').where({ shop_id: f.shopId, lasyncro_product_id: productId }).first('lasyncro_product_id'),
      variant: await trx('variants').where({ shop_id: f.shopId, lasyncro_variant_id: variantId }).first('lasyncro_variant_id'),
      order: await trx('orders').where({ shop_id: f.shopId, lasyncro_order_id: orderId }).first('lasyncro_order_id'),
      movement: await trx('inventory_movements').where({ shop_id: f.shopId,
        lasyncro_inventory_movement_id: movementId }).first('lasyncro_inventory_movement_id', 'quantity_delta'),
      event: await trx('domain_events').where({ shop_id: f.shopId, id: historicalEventId }).first('id'),
    }));
    expect(preserved).toEqual({
      product: { lasyncro_product_id: productId },
      variant: { lasyncro_variant_id: variantId },
      order: { lasyncro_order_id: orderId },
      movement: { lasyncro_inventory_movement_id: movementId, quantity_delta: 4 },
      event: { id: String(historicalEventId) },
    });
    expectFreshState(await integrationState(f), f.integrationId);
  });

  it('finalization failure rolls back credential activation and sync reset atomically', async () => {
    const f = await fixture('atomic-failure');
    await transitionTo(f, 'FAILED');
    const beforeIntegration = await integrationState(f);
    const prepared = await prepare(f);
    const fencedCredential = await credentialState(f);

    const installationBefore = await withTenant(f.shopId, trx => trx('shopify_app_installations').where({id:f.installationId}).first());
    const admin = new pg.Client({host:process.env.PGHOST,port:Number(process.env.PGPORT),
      database:process.env.PGDATABASE,user:process.env.PGMIGRATION_USER,password:process.env.PGMIGRATION_PASSWORD});
    await admin.connect();
    try {
      await admin.query(`CREATE FUNCTION public.gh1068_s3b_finalizer_fault() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AFTER_CREDENTIAL_ACTIVATION'; END $$;
        CREATE TRIGGER gh1068_s3b_finalizer_fault BEFORE UPDATE ON public.integrations
        FOR EACH ROW WHEN (OLD.shop_id=${f.shopId}) EXECUTE FUNCTION public.gh1068_s3b_finalizer_fault()`);
      await expect(finalizeShopifyAdminCredentialReconnect({
        ...prepared, credentials: acquiredCredentials(f, 'atomic-failure'),
      })).rejects.toThrow('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
    } finally {
      await admin.query('DROP TRIGGER IF EXISTS gh1068_s3b_finalizer_fault ON public.integrations; DROP FUNCTION IF EXISTS public.gh1068_s3b_finalizer_fault()');
      await admin.end();
    }
    expect(await withTenant(f.shopId, trx => trx('shopify_app_installations').where({id:f.installationId}).first())).toEqual(installationBefore);

    expect(await integrationState(f)).toEqual(beforeIntegration);
    const afterCredential = await credentialState(f);
    expect(afterCredential?.credential_state).toBe('REAUTH_REQUIRED');
    expect(String(afterCredential?.credential_generation)).toBe(prepared.generation);
    expect(afterCredential?.access_token_encrypted).toBe(fencedCredential?.access_token_encrypted);
    expect(afterCredential?.rotation_lease_token).toBe(prepared.leaseToken);
  });
});
