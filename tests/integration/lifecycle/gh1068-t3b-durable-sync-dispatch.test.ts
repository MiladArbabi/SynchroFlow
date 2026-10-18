/**
 * GH-1068 / T3-B — durable, recoverable fresh-sync dispatch.
 *
 * Real PostgreSQL principals only: sf_app (runtime), the provisioned executor
 * E and finalizer owner O. The RabbitMQ boundary is an injected publisher and
 * a recording channel; Shopify collection is replaced by a spy. The migration
 * role is used only for read-only observation, rolled-back catalog probes,
 * clock ageing of outbox attempt timestamps and one disposable fault trigger.
 */

jest.mock('api-src/services/shopify-sync-orchestrator.service', () => ({
  performSmartSync: (...args: unknown[]) => mockSmartSync(...args),
}));

jest.mock('api-src/queue', () => ({
  getQueueChannel: () => mockChannel,
}));

jest.mock('api-src/services/shopify/shopifyWebhook.service', () => ({
  registerWebhooksForShop: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('api-src/services/shopify/shopifyRefundBackfill.service', () => ({
  backfillShopifyRefunds: jest.fn().mockResolvedValue({ shopId: 0, refundsBackfilled: 0 }),
}));

const mockSmartSync = jest.fn();
const mockChannel = {
  consume: jest.fn().mockResolvedValue({ consumerTag: 'gh1068-t3b' }),
  cancel: jest.fn().mockResolvedValue(undefined),
  ack: jest.fn(),
  nack: jest.fn(),
  sendToQueue: jest.fn(),
};

import crypto from 'crypto';
import pg from 'pg';
import knexFactory, { type Knex } from 'knex';
import db, { systemQuery, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt } from 'api-src/security/encryption.service';
import { closeShopifyReconnectExecutor } from 'api-src/services/shopify/shopifyReconnectExecutor.db';
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import {
  claimShopifyAdminCredentialRotation,
  finalizeShopifyAdminCredentialReconnect,
  finalizeShopifyAdminCredentialRotation,
  prepareShopifyAdminCredentialReconnect,
  type ShopifyAdminCredentialReconnectPrepared,
} from 'api-src/services/shopify/shopifyAdminCredentialLifecycle.service';
import { resolveShopifyAdminCredentialForConsumer } from
  'api-src/services/shopify/shopifyAdminCredentialConsumer.service';
import {
  claimShopifySyncCycle,
  recordShopifySyncDispatchIntent,
  updateIntegrationStatus,
  type ShopifySyncExecutionAuthority,
} from 'api-src/services/shopify/shopifyIntegrationStatus.service';
import { performInitialSync } from 'api-src/services/shopify.service';
import { dispatchShopifySyncIntentOnce } from 'api-src/workers/domain-event-outbox.dispatcher';
import { processSyncJob, startSyncWorker, stopSyncWorker } from 'api-src/sync.worker';
import { handleIntegrationSyncDispatchRequested } from
  'api-src/projection/handlers/integration.sync_dispatch_requested';
import { handleIntegrationSyncCycleStarted } from
  'api-src/projection/handlers/integration.sync_cycle_started';
import { handleIntegrationSyncRequested } from
  'api-src/projection/handlers/integration.sync_requested';
import { projectionRegistry } from 'api-src/projection/projection.registry';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import { assertSecurityPostconditions } from
  '../../../apps/backend/migrations/20261018120000_0216_durable_shopify_sync_dispatch';

const SYNC_EVENT = 'integration/sync_dispatch_requested';
const E = 'sf_shopify_reconnect_executor';
const O = 'sf_shopify_reconnect_owner';
const DEADLINE_MS = 10_000;

type Fixture = {
  shopId: number; domain: string; installationId: number; integrationId: number;
  authority: ShopifySyncExecutionAuthority;
};
type Message = { integrationId: number; intentDomainEventId: number };

let observer: Knex | undefined;
let admin: Knex | undefined;

function disposableDb(): string {
  const database = process.env.PGDATABASE ?? '';
  if (process.env.NODE_ENV !== 'test' || process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1'
    || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(database) || process.env.PGUSER !== 'sf_app'
    || !process.env.PGMIGRATION_USER || process.env.PGMIGRATION_USER === 'sf_app') {
    throw new Error('GH1068_T3B_REFUSING_UNSAFE_DB');
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
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => { if (timer) clearTimeout(timer); });
}

function acquired(f: Fixture, label: string) {
  const now = Date.now();
  return {
    accessToken: `t3b-access-${label}`, refreshToken: `t3b-refresh-${label}`,
    accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
    grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`, currencyCode: 'USD', name: null,
      contactEmail: null, ianaTimezone: null },
  };
}

/** Domain labels obey the ratified lowercase hostname contract (no '_'). */
async function fixture(label: string, options: { integration?: boolean } = {}): Promise<Fixture> {
  const suffix = `${label}-${crypto.randomUUID()}`;
  const domain = `${suffix}.myshopify.com`;
  const shopId = await systemTransaction(trx => createTenantShop(trx, suffix));
  return withTenant(shopId, async trx => {
    let integrationId = 0;
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
    const credential = await trx('shopify_admin_credentials')
      .where({ shop_id: shopId, installation_id: installation.id }).first('credential_generation');
    return { shopId, domain, installationId: Number(installation.id), integrationId,
      authority: { installationId: Number(installation.id), shopDomain: domain,
        generation: String(credential.credential_generation) } };
  });
}

async function prepare(f: Fixture): Promise<ShopifyAdminCredentialReconnectPrepared> {
  const prepared = await prepareShopifyAdminCredentialReconnect({
    shopId: f.shopId, shopDomain: f.domain, now: new Date() });
  if (prepared.kind !== 'RECONNECT_PREPARED') throw new Error(`T3B_NOT_PREPARED:${prepared.kind}`);
  return prepared;
}

async function reconnect(f: Fixture, label: string) {
  const prepared = await prepare(f);
  const result = await finalizeShopifyAdminCredentialReconnect({ ...prepared, credentials: acquired(f, label) });
  if (result.kind !== 'RECONNECTED') throw new Error(`T3B_NOT_RECONNECTED:${result.kind}`);
  f.integrationId = result.integration.id;
  return { prepared, result };
}

async function currentAuthority(f: Fixture): Promise<ShopifySyncExecutionAuthority> {
  const ready = await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: new Date() });
  if (ready.kind !== 'READY') throw new Error(`T3B_AUTHORITY_NOT_READY:${ready.kind}`);
  return { installationId: ready.installationId, shopDomain: ready.shopDomain, generation: ready.generation };
}

async function intents(shopId: number) {
  return withTenant(shopId, trx => trx('domain_events as event')
    .leftJoin('domain_event_outbox as outbox', 'outbox.domain_event_id', 'event.id')
    .where({ 'event.shop_id': shopId, 'event.event_type': SYNC_EVENT })
    .select('event.id', 'event.event_payload', 'event.external_event_id', 'outbox.id as outbox_id',
      'outbox.published_at', 'outbox.processing_at', 'outbox.retry_count', 'outbox.last_error')
    .orderBy('event.id'));
}

async function integration(f: Fixture) {
  return withTenant(f.shopId, trx => trx('integrations').where({ id: f.integrationId, shop_id: f.shopId })
    .first('id', 'sync_status', 'sync_progress_current', 'sync_progress_total', 'sync_last_error'));
}

async function credentialRow(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId }).first());
}

async function outboxRow(outboxId: number) {
  return (await observer!('domain_event_outbox').where({ id: outboxId })
    .first('published_at', 'processing_at', 'retry_count', 'last_error', 'last_attempt_at'));
}

/** Publish every currently eligible intent through a recording publisher. */
async function drainEligible(published: Message[] = []): Promise<Message[]> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const result = await dispatchShopifySyncIntentOnce(async message => { published.push(message); });
    if (result.kind === 'IDLE') return published;
  }
  throw new Error('T3B_DISPATCH_DRAIN_NOT_IDLE');
}

async function ageOutbox(outboxId: number, column: 'last_attempt_at' | 'processing_at', seconds: number) {
  await admin!.raw(`UPDATE public.domain_event_outbox SET ${column} = now() - make_interval(secs => ?)
    WHERE id = ?`, [seconds, outboxId]);
}

function delivery(message: Record<string, unknown>) {
  return { content: Buffer.from(JSON.stringify(message)) };
}

async function executorClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.SHOPIFY_RECONNECT_DATABASE_URL });
  await client.connect();
  expect((await client.query('SELECT session_user::text AS s, current_user::text AS c')).rows[0])
    .toEqual({ s: E, c: E });
  return client;
}

async function sqlState(client: pg.Client, sql: string, values?: unknown[]): Promise<string | undefined> {
  try { await client.query(sql, values); return undefined; }
  catch (error) { return (error as pg.DatabaseError).code; }
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ||= 'gh1068-t3b-regression-encryption-key-2026';
  const database = disposableDb();
  observer = knexFactory({ client: 'pg', pool: { min: 0, max: 1 },
    connection: connection(database, '-c default_transaction_read_only=on -c statement_timeout=2000') });
  admin = knexFactory({ client: 'pg', pool: { min: 0, max: 1 }, connection: connection(database) });
  const identity = await observer.raw(`SELECT current_database() AS database,
    current_setting('transaction_read_only') AS read_only`);
  expect(identity.rows).toEqual([{ database, read_only: 'on' }]);
  await startSyncWorker();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSmartSync.mockResolvedValue(undefined);
});

afterAll(async () => {
  const results = await Promise.allSettled([stopSyncWorker(), observer?.destroy(), admin?.destroy(),
    db.destroy(), closeShopifyReconnectExecutor()]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
});

describe('GH-1068 T3-B — atomic durable sync intent', () => {
  it('finalized reconnect commits exactly one current, unpublished intent with PENDING/0/0/NULL', async () => {
    const f = await fixture('atomic-intent');
    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETED'] as const) {
      await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId, status,
        executionAuthority: f.authority, progressCurrent: 3, progressTotal: 3, error: null });
    }
    const { prepared } = await reconnect(f, 'atomic-intent');
    const rows = await intents(f.shopId);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_payload).toEqual({ integration_id: f.integrationId,
      installation_id: f.installationId, generation: prepared.generation, source: 'reconnect' });
    expect(rows[0].external_event_id)
      .toBe(`internal:${SYNC_EVENT}:${f.integrationId}:reconnect:${prepared.generation}`);
    expect(rows[0]).toMatchObject({ published_at: null, processing_at: null, retry_count: 0 });
    expect(rows[0].outbox_id).not.toBeNull();
    expect(await integration(f)).toEqual({ id: f.integrationId, sync_status: 'PENDING',
      sync_progress_current: 0, sync_progress_total: 0, sync_last_error: null });

    // The generic publish-marker path never consumes the dedicated intent.
    await systemQuery(db.raw('SELECT * FROM public.dispatch_domain_event_outbox_batch(100)'));
    expect((await intents(f.shopId))[0]).toMatchObject({ published_at: null, processing_at: null });
  });

  it('a failed intent insertion rolls back credential activation and the PENDING reset', async () => {
    const f = await fixture('intent-fault');
    await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId,
      status: 'SYNCING_PRODUCTS', executionAuthority: f.authority, error: null });
    await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId,
      status: 'FAILED', executionAuthority: f.authority, error: 'historical-error' });
    const before = await integration(f);
    const prepared = await prepare(f);
    const fenced = await credentialRow(f);
    const fault = new pg.Client(connection(process.env.PGDATABASE!));
    await fault.connect();
    try {
      await fault.query(`CREATE FUNCTION public.gh1068_t3b_intent_fault() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_INTENT_INSERT_FAILURE'; END $$;
        CREATE TRIGGER gh1068_t3b_intent_fault BEFORE INSERT ON public.domain_events
        FOR EACH ROW WHEN (NEW.shop_id = ${f.shopId}) EXECUTE FUNCTION public.gh1068_t3b_intent_fault()`);
      await expect(finalizeShopifyAdminCredentialReconnect({ ...prepared,
        credentials: acquired(f, 'intent-fault') })).rejects.toThrow('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
    } finally {
      await fault.query(`DROP TRIGGER IF EXISTS gh1068_t3b_intent_fault ON public.domain_events;
        DROP FUNCTION IF EXISTS public.gh1068_t3b_intent_fault()`);
      await fault.end();
    }
    expect(await intents(f.shopId)).toEqual([]);
    expect(await integration(f)).toEqual(before);
    const after = await credentialRow(f);
    expect(after.credential_state).toBe('REAUTH_REQUIRED');
    expect(after.access_token_encrypted).toBe(fenced.access_token_encrypted);
    expect(after.rotation_lease_token).toBe(prepared.leaseToken);
  });

  it('first-install finalization (no integration) and reinstall (UNINSTALLED) commit intents for the resulting integration', async () => {
    const fresh = await fixture('finalizer-first-install', { integration: false });
    await reconnect(fresh, 'finalizer-first-install');
    expect(fresh.integrationId).toBeGreaterThan(0);
    const freshIntents = await intents(fresh.shopId);
    expect(freshIntents).toHaveLength(1);
    expect(freshIntents[0].event_payload.integration_id).toBe(fresh.integrationId);

    const reinstall = await fixture('finalizer-reinstall');
    await withTenant(reinstall.shopId, trx => trx('shopify_app_installations')
      .where({ id: reinstall.installationId }).update({ uninstalled_at: new Date() }));
    const { prepared } = await reconnect(reinstall, 'finalizer-reinstall');
    expect(prepared.installationState).toBe('UNINSTALLED');
    const reinstallIntents = await intents(reinstall.shopId);
    expect(reinstallIntents).toHaveLength(1);
    expect(reinstallIntents[0].event_payload).toMatchObject({ integration_id: reinstall.integrationId,
      source: 'reconnect' });
  });
});

describe('GH-1068 T3-B — durable dispatch', () => {
  it('marks an intent published only after broker confirmation; the message names the exact intent', async () => {
    await drainEligible();
    const f = await fixture('confirmed-publish');
    await reconnect(f, 'confirmed-publish');
    const [intent] = await intents(f.shopId);
    const confirmation = deferred();
    const sent: Message[] = [];
    const dispatching = dispatchShopifySyncIntentOnce(async message => {
      sent.push(message);
      await confirmation.promise;
    });
    const deadline = Date.now() + DEADLINE_MS;
    while (sent.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(sent).toEqual([{ integrationId: f.integrationId, intentDomainEventId: Number(intent.id) }]);
    const unconfirmed = await outboxRow(Number(intent.outbox_id));
    expect(unconfirmed.published_at).toBeNull();
    expect(unconfirmed.processing_at).not.toBeNull();
    confirmation.resolve();
    expect(await timeout(dispatching, 'confirmed dispatch')).toMatchObject({ kind: 'PUBLISHED',
      intentDomainEventId: Number(intent.id), integrationId: f.integrationId, recovery: false });
    const confirmed = await outboxRow(Number(intent.outbox_id));
    expect(confirmed.published_at).not.toBeNull();
    expect(confirmed.processing_at).toBeNull();
    expect(await dispatchShopifySyncIntentOnce(async () => { throw new Error('NOT_EXPECTED'); }))
      .toEqual({ kind: 'IDLE' });
  });

  it('an unconfirmed publish stays durable, records the failure and retries after backoff', async () => {
    await drainEligible();
    const f = await fixture('unconfirmed-publish');
    await reconnect(f, 'unconfirmed-publish');
    const [intent] = await intents(f.shopId);
    expect(await dispatchShopifySyncIntentOnce(async () => { throw new Error('BROKER_CONFIRM_TIMEOUT'); }))
      .toMatchObject({ kind: 'PUBLISH_REJECTED', intentDomainEventId: Number(intent.id) });
    const rejected = await outboxRow(Number(intent.outbox_id));
    expect(rejected).toMatchObject({ published_at: null, processing_at: null, retry_count: 1,
      last_error: 'BROKER_CONFIRM_TIMEOUT' });
    // Backoff: the failed intent is not reclaimed immediately.
    expect(await dispatchShopifySyncIntentOnce(async () => { throw new Error('NOT_EXPECTED'); }))
      .toEqual({ kind: 'IDLE' });
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 11);
    const retried: Message[] = [];
    expect(await dispatchShopifySyncIntentOnce(async message => { retried.push(message); }))
      .toMatchObject({ kind: 'PUBLISHED', intentDomainEventId: Number(intent.id) });
    expect(retried).toEqual([{ integrationId: f.integrationId, intentDomainEventId: Number(intent.id) }]);
    expect((await outboxRow(Number(intent.outbox_id))).published_at).not.toBeNull();
  });

  it('a dispatcher crash after claim is recovered only after the claim lease expires', async () => {
    await drainEligible();
    const f = await fixture('dispatcher-crash');
    await reconnect(f, 'dispatcher-crash');
    const [intent] = await intents(f.shopId);
    const claimed = await systemQuery(db.raw('SELECT * FROM public.claim_shopify_sync_dispatch_outbox()'));
    expect(claimed.rows).toHaveLength(1);
    expect(Number(claimed.rows[0].domain_event_id)).toBe(Number(intent.id));
    // The claiming process "crashed": no confirmation and no failure record.
    expect(await dispatchShopifySyncIntentOnce(async () => { throw new Error('NOT_EXPECTED'); }))
      .toEqual({ kind: 'IDLE' });
    // A real crashed claim ages its lease and attempt clock together.
    await ageOutbox(Number(intent.outbox_id), 'processing_at', 121);
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 121);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined))
      .toMatchObject({ kind: 'PUBLISHED', intentDomainEventId: Number(intent.id) });
  });

  it('a published but unconsumed PENDING intent is re-dispatched, bounded, and never after its cycle starts', async () => {
    await drainEligible();
    const f = await fixture('lost-delivery');
    await reconnect(f, 'lost-delivery');
    const [intent] = await intents(f.shopId);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toMatchObject({ kind: 'PUBLISHED' });
    // Delivery lost: still PENDING. Not re-dispatched inside the recovery window.
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toEqual({ kind: 'IDLE' });
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 301);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toMatchObject({
      kind: 'PUBLISHED', intentDomainEventId: Number(intent.id), recovery: true });
    expect((await outboxRow(Number(intent.outbox_id))).retry_count).toBe(1);

    // Rate-limited: after one recovery the next republish waits 10 minutes.
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 599);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toEqual({ kind: 'IDLE' });

    // Once its cycle started, the intent is no longer eligible for recovery.
    expect(await claimShopifySyncCycle({ integrationId: f.integrationId, shopId: f.shopId,
      intentDomainEventId: Number(intent.id), executionAuthority: await currentAuthority(f) }))
      .toEqual({ kind: 'CLAIMED' });
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 301);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toEqual({ kind: 'IDLE' });
  });

  it('the intent projection is inert: rebuild or replay never dispatches or launches sync', async () => {
    expect(projectionRegistry[SYNC_EVENT]).toBe(handleIntegrationSyncDispatchRequested);
    const f = await fixture('projection-inert');
    await reconnect(f, 'projection-inert');
    const [intent] = await intents(f.shopId);
    // Any use of the projection transaction (query, mutation or escape) is a contract violation.
    const trap = new Proxy(function trapped() {}, {
      get: () => { throw new Error('T3B_PROJECTION_TRX_USED'); },
      apply: () => { throw new Error('T3B_PROJECTION_TRX_USED'); },
    }) as unknown as Knex.Transaction;
    jest.useFakeTimers();
    try {
      await handleIntegrationSyncDispatchRequested({ domainEvent: { id: intent.id, shop_id: f.shopId,
        event_type: SYNC_EVENT, event_payload: intent.event_payload }, domain_event_id: Number(intent.id),
        canonicalEventTime: new Date(), trx: trap });
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
    expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect((await intents(f.shopId))[0]).toMatchObject({ published_at: null, processing_at: null });
  });
});

describe('GH-1068 T3-B — single-flight worker execution', () => {
  it('duplicate deliveries of the current intent start exactly one cycle', async () => {
    const f = await fixture('duplicate-delivery');
    await reconnect(f, 'duplicate-delivery');
    const [intent] = await intents(f.shopId);
    const gate = deferred();
    mockSmartSync.mockImplementationOnce(() => gate.promise);
    const message = { integrationId: f.integrationId, intentDomainEventId: Number(intent.id) };
    const first = processSyncJob(delivery(message));
    const deadline = Date.now() + DEADLINE_MS;
    while (mockSmartSync.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    await timeout(processSyncJob(delivery(message)), 'duplicate delivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect((await integration(f)).sync_status).toBe('SYNCING_PRODUCTS');
    gate.resolve();
    await timeout(first, 'first delivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(mockChannel.ack).toHaveBeenCalledTimes(2);
    expect(mockChannel.nack).not.toHaveBeenCalled();
    expect(await startFacts(f.shopId)).toEqual([{ external_event_id:
      `internal:integration/sync_cycle_started:${intent.id}`,
      event_payload: { integration_id: f.integrationId, intent_domain_event_id: Number(intent.id) } }]);
    expect(await syncRequestedCount(f.shopId)).toBe(0);
  });

  it('concurrent claims for one intent produce exactly one CLAIMED and no second write', async () => {
    const f = await fixture('concurrent-claim');
    await reconnect(f, 'concurrent-claim');
    const [intent] = await intents(f.shopId);
    const authority = await currentAuthority(f);
    const input = { integrationId: f.integrationId, shopId: f.shopId,
      intentDomainEventId: Number(intent.id), executionAuthority: authority };
    const outcomes = await timeout(Promise.all([claimShopifySyncCycle(input), claimShopifySyncCycle(input)]),
      'concurrent claims');
    expect(outcomes.map(outcome => outcome.kind).sort()).toEqual(['CLAIMED', 'REJECTED']);
    expect(await integration(f)).toEqual({ id: f.integrationId, sync_status: 'SYNCING_PRODUCTS',
      sync_progress_current: 0, sync_progress_total: 0, sync_last_error: null });
    expect(await startFacts(f.shopId)).toHaveLength(1);
    // A later claim of the consumed intent adds no second start fact.
    expect(await claimShopifySyncCycle(input)).toEqual({ kind: 'REJECTED', reason: 'INTENT_CONSUMED' });
    expect(await startFacts(f.shopId)).toHaveLength(1);
  });

  it('an older intent cannot start the newer cycle; only the current intent may', async () => {
    const f = await fixture('stale-intent');
    await reconnect(f, 'stale-intent-1');
    await reconnect(f, 'stale-intent-2');
    const [older, current] = await intents(f.shopId);
    expect(Number(current.id)).toBeGreaterThan(Number(older.id));
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId,
      intentDomainEventId: Number(older.id) })), 'older intent');
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect((await integration(f)).sync_status).toBe('PENDING');
    expect(await startFacts(f.shopId)).toEqual([]);
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId,
      intentDomainEventId: Number(current.id) })), 'current intent');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect((await integration(f)).sync_status).toBe('SYNCING_PRODUCTS');
    expect(mockChannel.ack).toHaveBeenCalledTimes(2);
    // Only the current intent has a start fact; the superseded one never does.
    expect((await startFacts(f.shopId)).map(fact => fact.event_payload.intent_domain_event_id))
      .toEqual([Number(current.id)]);
  });

  it('a claimed cycle proceeds through real initial-sync collection to COMPLETED', async () => {
    const f = await fixture('claimed-collection');
    await reconnect(f, 'claimed-collection');
    const [intent] = await intents(f.shopId);
    const authority = await currentAuthority(f);
    expect(await claimShopifySyncCycle({ integrationId: f.integrationId, shopId: f.shopId,
      intentDomainEventId: Number(intent.id), executionAuthority: authority })).toEqual({ kind: 'CLAIMED' });
    await systemQuery(db('projection_cursors').insert({ projection_name: 'orders_projection',
      last_processed_event_id: '9223372036854775807' }).onConflict('projection_name').ignore());
    const client = { request: jest.fn(async (query: string) => query.includes('orders(')
      ? { data: { orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
      : { data: { products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
        shop: { id: 'gid://shopify/Shop/offline', name: 'Offline', email: 'offline@example.test',
          currencyCode: 'USD' } } }) };
    const ready = await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: new Date() });
    if (ready.kind !== 'READY') throw new Error('T3B_COLLECTION_NOT_READY');
    await performInitialSync(ready.accessToken, f.domain, f.shopId, f.integrationId,
      { shopifyClient: client, executionAuthority: authority });
    expect((await integration(f)).sync_status).toBe('COMPLETED');
  }, 60_000);

  it('credential refresh is not a new cycle: the intent stays current under the rotated generation', async () => {
    const f = await fixture('refresh-during-dispatch');
    const { result } = await reconnect(f, 'refresh-during-dispatch');
    const [intent] = await intents(f.shopId);
    const reconnectAuthority = await currentAuthority(f);
    expect(reconnectAuthority.generation).toBe(result.generation);

    const future = new Date(Date.now() + 2 * 86_400_000);
    const claim = await claimShopifyAdminCredentialRotation({ shopId: f.shopId, now: future });
    if (claim.kind !== 'ROTATION_CLAIMED') throw new Error(`T3B_ROTATION_NOT_CLAIMED:${claim.kind}`);
    const rotated = await finalizeShopifyAdminCredentialRotation({ shopId: f.shopId,
      installationId: claim.installationId, generation: String(claim.generation),
      leaseToken: claim.leaseToken, now: future, credentials: {
        accessToken: 't3b-rotated-access', refreshToken: 't3b-rotated-refresh',
        accessExpiresAt: new Date(future.getTime() + 86_400_000),
        refreshExpiresAt: new Date(future.getTime() + 604_800_000),
        grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING } });
    expect(rotated.kind).toBe('ROTATED');
    const rotatedGeneration = (rotated as { generation: string }).generation;
    expect(BigInt(rotatedGeneration)).toBe(BigInt(result.generation) + 1n);

    // A worker holding the pre-refresh authority is fenced without writes.
    await expect(claimShopifySyncCycle({ integrationId: f.integrationId, shopId: f.shopId,
      intentDomainEventId: Number(intent.id), executionAuthority: reconnectAuthority }))
      .rejects.toThrow('SHOPIFY_SYNC_STALE_AUTHORITY');
    expect((await integration(f)).sync_status).toBe('PENDING');
    expect((await intents(f.shopId))[0]).toMatchObject({ published_at: null, processing_at: null });

    // The same intent starts its cycle under the refreshed authority.
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId,
      intentDomainEventId: Number(intent.id) })), 'post-refresh delivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(mockSmartSync.mock.calls[0][4]).toEqual({ installationId: f.installationId,
      shopDomain: f.domain, generation: rotatedGeneration });
    expect((await integration(f)).sync_status).toBe('SYNCING_PRODUCTS');
  });

  it('temporary credential unavailability neither starts nor discards a valid PENDING intent', async () => {
    const f = await fixture('credential-unavailable');
    await reconnect(f, 'credential-unavailable');
    const [intent] = await intents(f.shopId);
    await withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId }).update({
      access_expires_at: new Date(Date.now() - 60_000), rotation_lease_token: crypto.randomUUID(),
      rotation_lease_expires_at: new Date(Date.now() + 60_000), rotation_started_at: new Date() }));
    const unavailable = await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: new Date() });
    expect(unavailable.kind).toBe('REFRESH_IN_PROGRESS');
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId,
      intentDomainEventId: Number(intent.id) })), 'unavailable delivery');
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect((await integration(f)).sync_status).toBe('PENDING');
    // The durable intent is untouched and remains current and dispatchable.
    expect((await intents(f.shopId))[0]).toMatchObject({ published_at: null, processing_at: null,
      retry_count: 0 });
    const published = await drainEligible();
    expect(published).toContainEqual({ integrationId: f.integrationId, intentDomainEventId: Number(intent.id) });
  });

  it('messages without an exact positive intent identity never start a cycle', async () => {
    const f = await fixture('missing-intent');
    await reconnect(f, 'missing-intent');
    for (const message of [{ integrationId: f.integrationId }, { integrationId: f.integrationId,
      intentDomainEventId: 0 }, { integrationId: f.integrationId, intentDomainEventId: '1' }]) {
      await timeout(processSyncJob(delivery(message)), 'missing intent');
    }
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect((await integration(f)).sync_status).toBe('PENDING');
  });
});

describe('GH-1068 T3-B — tenant, role and billing isolation', () => {
  it('a forged cross-tenant intent is never dispatched and never starts the other tenant’s cycle', async () => {
    const victim = await fixture('victim');
    await reconnect(victim, 'victim');
    const attacker = await fixture('attacker');
    const forgedId = await withTenant(attacker.shopId, async trx => {
      const [event] = await trx('domain_events').insert({ shop_id: attacker.shopId, event_type: SYNC_EVENT,
        event_payload: { integration_id: victim.integrationId, installation_id: victim.installationId,
          source: 'install' }, event_time: trx.fn.now(), event_version: 1,
        external_event_id: `t3b-forged-${crypto.randomUUID()}` }).returning('id');
      return Number(event.id);
    });
    const published = await drainEligible();
    expect(published.some(message => message.intentDomainEventId === forgedId)).toBe(false);
    await timeout(processSyncJob(delivery({ integrationId: victim.integrationId,
      intentDomainEventId: forgedId })), 'forged delivery');
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect((await integration(victim)).sync_status).toBe('PENDING');
    expect(await startFacts(victim.shopId)).toEqual([]);
    expect(await startFacts(attacker.shopId)).toEqual([]);
  });

  it('restricted principals cannot reach dispatch authority or write intents directly', async () => {
    await expect(assertSecurityPostconditions(admin!)).resolves.toBeUndefined();
    const e = await executorClient();
    try {
      expect(await sqlState(e, 'SELECT * FROM public.claim_shopify_sync_dispatch_outbox()')).toBe('42501');
      expect(await sqlState(e, 'SELECT public.mark_shopify_sync_dispatch_outbox_published(1)')).toBe('42501');
      expect(await sqlState(e, 'SELECT public.record_shopify_sync_dispatch_outbox_failure(1, $1)', ['x']))
        .toBe('42501');
      expect(await sqlState(e, `INSERT INTO public.domain_events (shop_id, event_type, event_payload,
        event_time) VALUES (1, '${SYNC_EVENT}', '{}', now())`)).toBe('42501');
      expect(await sqlState(e, 'INSERT INTO public.domain_event_outbox (domain_event_id) VALUES (1)'))
        .toBe('42501');
    } finally { await e.end(); }
    const owner = await observer!.raw(`SELECT
        has_table_privilege(?, 'public.domain_events', 'SELECT') AS events_select,
        has_table_privilege(?, 'public.domain_event_outbox', 'SELECT,UPDATE,DELETE') AS outbox_other,
        has_function_privilege('sf_app', 'public.claim_shopify_sync_dispatch_outbox()', 'EXECUTE') AS app_claim`,
      [O, O]);
    expect(owner.rows).toEqual([{ events_select: false, outbox_other: false, app_claim: true }]);
  });

  it('0216 postconditions reject an unexpected owner privilege', async () => {
    await expect(admin!.transaction(async trx => {
      await trx.raw(`GRANT SELECT ON public.domain_events TO ${O}`);
      await assertSecurityPostconditions(trx);
    })).rejects.toThrow(/RECONNECT_INTENT_AUTHORITY_INVALID/);
    await expect(admin!.transaction(async trx => {
      await trx.raw(`GRANT EXECUTE ON FUNCTION public.claim_shopify_sync_dispatch_outbox() TO ${E}`);
      await assertSecurityPostconditions(trx);
    })).rejects.toThrow(/SYNC_DISPATCH_FUNCTION_AUTHORITY_INVALID/);
    await expect(assertSecurityPostconditions(admin!)).resolves.toBeUndefined();
  });

  it('billing overage rows are isolated from sync dispatch claim, mark and failure authority', async () => {
    const f = await fixture('billing-isolation');
    const billing = await withTenant(f.shopId, async trx => {
      const [event] = await trx('domain_events').insert({ shop_id: f.shopId, event_type: 'billing/overage',
        event_payload: { billing_provider: 'shopify', overage_units: 1,
          idempotency_key: `t3b-${crypto.randomUUID()}`, shop_gid: `gid://shopify/Shop/${f.shopId}` },
        event_time: trx.fn.now(), event_version: 1 }).returning('id');
      const outbox = await trx('domain_event_outbox').where({ domain_event_id: event.id }).first('id');
      return { eventId: Number(event.id), outboxId: Number(outbox.id) };
    });
    const before = await outboxRow(billing.outboxId);
    const published = await drainEligible();
    expect(published.some(message => message.intentDomainEventId === billing.eventId)).toBe(false);
    await systemQuery(db.raw('SELECT * FROM public.dispatch_domain_event_outbox_batch(100)'));
    const marked = await systemQuery(db.raw('SELECT public.mark_shopify_sync_dispatch_outbox_published(?) AS ok',
      [billing.outboxId]));
    const recorded = await systemQuery(db.raw(
      'SELECT public.record_shopify_sync_dispatch_outbox_failure(?, ?) AS ok', [billing.outboxId, 'x']));
    expect(marked.rows[0].ok).toBe(false);
    expect(recorded.rows[0].ok).toBe(false);
    expect(await outboxRow(billing.outboxId)).toEqual(before);
    // Leave no unpublished synthetic billing row for the billing dispatcher suites.
    await systemQuery(db.raw('SELECT public.mark_billing_overage_outbox_published(?)', [billing.outboxId]));
  });
});

async function cycleStarts(f: Fixture, intentId: number) {
  return withTenant(f.shopId, trx => trx('domain_events').where({ shop_id: f.shopId,
    external_event_id: `internal:integration/sync_cycle_started:${intentId}` }).select('id', 'event_type'));
}

/** First-install / legacy-bootstrap intent, written exactly as the OAuth persistence transaction does. */
async function installIntent(f: Fixture): Promise<number> {
  await withTenant(f.shopId, trx => recordShopifySyncDispatchIntent(trx, {
    shopId: f.shopId, integrationId: f.integrationId, installationId: f.installationId }));
  const rows = await intents(f.shopId);
  return Number(rows[rows.length - 1].id);
}

async function failCycle(f: Fixture) {
  await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId, status: 'FAILED',
    executionAuthority: await currentAuthority(f), error: 'synthetic-cycle-failure' });
}

describe('GH-1068 T3-B corrections — eventual recovery without attempt exhaustion', () => {
  it('more than 20 failed publishes stay durable, observable and recover when the broker returns', async () => {
    await drainEligible();
    const f = await fixture('broker-outage');
    await reconnect(f, 'broker-outage');
    const [intent] = await intents(f.shopId);
    for (let attempt = 1; attempt <= 22; attempt += 1) {
      expect(await dispatchShopifySyncIntentOnce(async () => { throw new Error(`BROKER_UNAVAILABLE_${attempt}`); }))
        .toMatchObject({ kind: 'PUBLISH_REJECTED', intentDomainEventId: Number(intent.id) });
      const row = await outboxRow(Number(intent.outbox_id));
      expect(row).toMatchObject({ published_at: null, processing_at: null, retry_count: attempt,
        last_error: `BROKER_UNAVAILABLE_${attempt}` });
      // Bounded frequency: never re-attempted inside its backoff window.
      expect(await dispatchShopifySyncIntentOnce(async () => { throw new Error('NOT_EXPECTED'); }))
        .toEqual({ kind: 'IDLE' });
      await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 301);
    }
    const sent: Message[] = [];
    expect(await dispatchShopifySyncIntentOnce(async message => { sent.push(message); }))
      .toMatchObject({ kind: 'PUBLISHED', intentDomainEventId: Number(intent.id) });
    expect(sent).toEqual([{ integrationId: f.integrationId, intentDomainEventId: Number(intent.id) }]);
    expect(await outboxRow(Number(intent.outbox_id))).toMatchObject({ retry_count: 22, last_error: null,
      processing_at: null });
    await timeout(processSyncJob(delivery(sent[0])), 'recovered delivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect((await integration(f)).sync_status).toBe('SYNCING_PRODUCTS');
  }, 60_000);

  it('a published but unstarted intent past 20 attempts remains recoverable at a capped rate', async () => {
    await drainEligible();
    const f = await fixture('recovery-past-20');
    await reconnect(f, 'recovery-past-20');
    const [intent] = await intents(f.shopId);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toMatchObject({ kind: 'PUBLISHED' });
    await admin!.raw('UPDATE public.domain_event_outbox SET retry_count = 25 WHERE id = ?', [intent.outbox_id]);
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 3599);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toEqual({ kind: 'IDLE' });
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 3601);
    expect(await dispatchShopifySyncIntentOnce(async () => undefined)).toMatchObject({ kind: 'PUBLISHED',
      intentDomainEventId: Number(intent.id), recovery: true });
    expect((await outboxRow(Number(intent.outbox_id))).retry_count).toBe(26);
  });

  it('an unconfirmed publish that was in fact delivered starts one cycle and is never republished', async () => {
    await drainEligible();
    const f = await fixture('confirm-uncertainty');
    await reconnect(f, 'confirm-uncertainty');
    const [intent] = await intents(f.shopId);
    let delivered: Message | undefined;
    expect(await dispatchShopifySyncIntentOnce(async message => {
      delivered = message;
      await processSyncJob(delivery(message));
      throw new Error('timeout');
    })).toMatchObject({ kind: 'PUBLISH_REJECTED', intentDomainEventId: Number(intent.id) });
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(await cycleStarts(f, Number(intent.id))).toHaveLength(1);
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 3601);
    expect(await dispatchShopifySyncIntentOnce(async () => { throw new Error('NOT_EXPECTED'); }))
      .toEqual({ kind: 'IDLE' });
    await timeout(processSyncJob(delivery(delivered!)), 'duplicate after uncertainty');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(await cycleStarts(f, Number(intent.id))).toHaveLength(1);
  });
});

describe('GH-1068 T3-B corrections — legacy bootstrap and one-time cycles', () => {
  it('a legacy FAILED integration is recovered exactly once by its bootstrap intent', async () => {
    const f = await fixture('legacy-failed');
    await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId,
      status: 'SYNCING_PRODUCTS', executionAuthority: f.authority, error: null });
    await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId,
      status: 'FAILED', executionAuthority: f.authority, error: 'historical-failure' });
    const intentId = await installIntent(f);
    const published = await drainEligible();
    expect(published).toContainEqual({ integrationId: f.integrationId, intentDomainEventId: intentId });
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId, intentDomainEventId: intentId })),
      'legacy delivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(await integration(f)).toEqual({ id: f.integrationId, sync_status: 'SYNCING_PRODUCTS',
      sync_progress_current: 0, sync_progress_total: 0, sync_last_error: null });
    expect(await cycleStarts(f, intentId)).toEqual([expect.objectContaining({
      event_type: 'integration/sync_cycle_started' })]);
    expect(await syncRequestedCount(f.shopId)).toBe(0);

    // The recovered cycle fails again: the same intent never restarts it.
    await failCycle(f);
    const [outbox] = (await intents(f.shopId)).filter(row => Number(row.id) === intentId);
    await ageOutbox(Number(outbox.outbox_id), 'last_attempt_at', 3601);
    const republished = await drainEligible();
    expect(republished.some(message => message.intentDomainEventId === intentId)).toBe(false);
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId, intentDomainEventId: intentId })),
      'legacy redelivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect((await integration(f)).sync_status).toBe('FAILED');
    expect(await startFacts(f.shopId)).toHaveLength(1);
  });

  it('a legacy COMPLETED integration is neither dispatched nor regressed by a bootstrap intent', async () => {
    const f = await fixture('legacy-completed');
    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETED'] as const) {
      await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId, status,
        executionAuthority: f.authority, progressCurrent: 2, progressTotal: 2, error: null });
    }
    const intentId = await installIntent(f);
    const published = await drainEligible();
    expect(published.some(message => message.intentDomainEventId === intentId)).toBe(false);
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId, intentDomainEventId: intentId })),
      'completed delivery');
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect((await integration(f)).sync_status).toBe('COMPLETED');
    expect(await cycleStarts(f, intentId)).toEqual([]);
  });

  it('a reconnect cycle that fails is never restarted by its own intent', async () => {
    const f = await fixture('reconnect-failed-cycle');
    await reconnect(f, 'reconnect-failed-cycle');
    const [intent] = await intents(f.shopId);
    const message = { integrationId: f.integrationId, intentDomainEventId: Number(intent.id) };
    await timeout(processSyncJob(delivery(message)), 'first delivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    await failCycle(f);
    await ageOutbox(Number(intent.outbox_id), 'last_attempt_at', 3601);
    expect((await drainEligible()).some(m => m.intentDomainEventId === Number(intent.id))).toBe(false);
    await timeout(processSyncJob(delivery(message)), 'redelivery');
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect((await integration(f)).sync_status).toBe('FAILED');
    expect(await cycleStarts(f, Number(intent.id))).toHaveLength(1);
  });
});

describe('GH-1068 T3-B corrections — exact owner grant necessity', () => {
  const INSERT_SQL = `INSERT INTO public.domain_events (shop_id, event_type, event_payload, event_time,
    event_version, external_event_id) VALUES (?, 'integration/sync_dispatch_requested',
    pg_catalog.jsonb_build_object('integration_id', 1), pg_catalog.transaction_timestamp(), 1, ?)`;

  /** Replays the finalizer's intent insert as O, in its search_path and tenant, then rolls back. */
  async function asOwner(shopId: number, revoke?: string): Promise<string> {
    let outcome = 'UNSET';
    await admin!.transaction(async trx => {
      if (revoke) await trx.raw(revoke);
      await trx.raw(`SET LOCAL ROLE ${O}`);
      await trx.raw(`SELECT set_config('search_path', 'pg_catalog, pg_temp', true),
        set_config('app.current_tenant', ?, true)`, [String(shopId)]);
      try {
        await trx.raw(INSERT_SQL, [shopId, `t3b-grant-${crypto.randomUUID()}`]);
        const rows = await trx.raw(`SELECT count(*)::int AS n FROM public.domain_event_outbox
          WHERE domain_event_id = currval(pg_catalog.pg_get_serial_sequence('public.domain_events', 'id'))`);
        outcome = `OK:${rows.rows[0].n}`;
      } catch (error) { outcome = (error as { code?: string }).code ?? 'ERROR'; }
      throw new Error('T3B_ROLLBACK');
    }).catch(error => { if (error.message !== 'T3B_ROLLBACK') throw error; });
    return outcome;
  }

  it('the full 0216 owner grant set is sufficient and every grant in it is necessary', async () => {
    const f = await fixture('owner-grant-necessity');
    // The outcome probe reads the outbox as O only through its own granted column.
    expect(await asOwner(f.shopId)).toBe('OK:1');
    const revocations = [
      ...['shop_id', 'event_type', 'event_payload', 'event_time', 'event_version', 'external_event_id']
        .map(column => `REVOKE INSERT (${column}) ON public.domain_events FROM ${O}`),
      `REVOKE SELECT (id) ON public.domain_events FROM ${O}`,
      `REVOKE SELECT (shop_id) ON public.domain_events FROM ${O}`,
      `REVOKE INSERT (domain_event_id) ON public.domain_event_outbox FROM ${O}`,
      `REVOKE SELECT (domain_event_id) ON public.domain_event_outbox FROM ${O}`,
      `REVOKE USAGE ON SEQUENCE ${'public.domain_events_id_seq'} FROM ${O}`,
      `REVOKE USAGE ON SEQUENCE ${'public.domain_event_outbox_id_seq'} FROM ${O}`,
    ];
    for (const revoke of revocations) {
      expect([revoke, await asOwner(f.shopId, revoke)]).toEqual([revoke, '42501']);
    }
    await expect(assertSecurityPostconditions(admin!)).resolves.toBeUndefined();
  });
});

/** Every one-time start fact recorded for the tenant. */
async function startFacts(shopId: number) {
  return withTenant(shopId, trx => trx('domain_events')
    .where({ shop_id: shopId, event_type: 'integration/sync_cycle_started' })
    .select('external_event_id', 'event_payload').orderBy('id'));
}

async function syncRequestedCount(shopId: number): Promise<number> {
  const [{ count }] = await withTenant(shopId, trx => trx('domain_events')
    .where({ shop_id: shopId, event_type: 'integration/sync_requested' }).count<{ count: string }[]>('* as count'));
  return Number(count);
}

describe('GH-1068 T3-B event contract — sync_cycle_started', () => {
  it('the start fact projection is inert under replay, and sync_requested observability is unchanged', async () => {
    expect(projectionRegistry['integration/sync_cycle_started']).toBe(handleIntegrationSyncCycleStarted);
    expect(projectionRegistry['integration/sync_requested']).toBe(handleIntegrationSyncRequested);
    expect(projectionRegistry[SYNC_EVENT]).toBe(handleIntegrationSyncDispatchRequested);
    const f = await fixture('start-fact-replay');
    await reconnect(f, 'start-fact-replay');
    const [intent] = await intents(f.shopId);
    await timeout(processSyncJob(delivery({ integrationId: f.integrationId,
      intentDomainEventId: Number(intent.id) })), 'start-fact delivery');
    const [fact] = await withTenant(f.shopId, trx => trx('domain_events')
      .where({ shop_id: f.shopId, event_type: 'integration/sync_cycle_started' }).select('*'));
    expect(fact).toBeDefined();
    const trap = new Proxy(function trapped() {}, {
      get: () => { throw new Error('T3B_PROJECTION_TRX_USED'); },
      apply: () => { throw new Error('T3B_PROJECTION_TRX_USED'); },
    }) as unknown as Knex.Transaction;
    const before = await integration(f);
    jest.useFakeTimers();
    try {
      for (let replay = 0; replay < 3; replay += 1) {
        await handleIntegrationSyncCycleStarted({ domainEvent: fact, domain_event_id: Number(fact.id),
          canonicalEventTime: new Date(), trx: trap });
      }
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
    expect(await integration(f)).toEqual(before);
    expect(await startFacts(f.shopId)).toHaveLength(1);
    // The claim emits no callback-observability event; that contract stays the callback's alone.
    expect(await syncRequestedCount(f.shopId)).toBe(0);
  });

  it('the start fact identity is unique-index enforced per intent', async () => {
    const f = await fixture('start-fact-unique');
    await reconnect(f, 'start-fact-unique');
    const [intent] = await intents(f.shopId);
    expect(await claimShopifySyncCycle({ integrationId: f.integrationId, shopId: f.shopId,
      intentDomainEventId: Number(intent.id), executionAuthority: await currentAuthority(f) }))
      .toEqual({ kind: 'CLAIMED' });
    const duplicate = await withTenant(f.shopId, trx => trx('domain_events').insert({ shop_id: f.shopId,
      event_type: 'integration/sync_cycle_started', event_payload: { integration_id: f.integrationId,
        intent_domain_event_id: Number(intent.id) }, event_time: trx.fn.now(), event_version: 1,
      external_event_id: `internal:integration/sync_cycle_started:${intent.id}` }))
      .then(() => 'INSERTED', error => error.code);
    expect(duplicate).toBe('23505');
    expect(await startFacts(f.shopId)).toHaveLength(1);
  });
});
