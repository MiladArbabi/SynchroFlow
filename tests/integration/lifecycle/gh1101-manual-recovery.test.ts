/**
 * GH-1101 — durable, truthful manual sync recovery.
 *
 * Real createApp routes (POST /sync/:integrationId and the legacy
 * POST /manual-initial-sync alias), JWT admission, requireAction, sf_app and
 * forced RLS on a disposable database. Shopify collection and the RabbitMQ
 * channel are doubles; the dispatcher claim, the fenced worker claim and the
 * one-time start fact are real.
 */
jest.mock('api-src/services/shopify.service', () => ({
  performInitialSync: (...args: unknown[]) => mockInitialSync(...args),
}));
jest.mock('api-src/services/shopify-sync-orchestrator.service', () => ({
  performSmartSync: (...args: unknown[]) => mockSmartSync(...args),
}));
jest.mock('api-src/queue', () => ({
  getQueueChannel: () => mockChannel,
}));
jest.mock('api-src/services/shopify/shopifyAdminCredentialRefreshProvider.service', () => ({
  refreshShopifyAdminCredential: jest.fn(async () => { throw new Error('GH1101_PROVIDER_CALLED'); }),
}));
jest.mock('@lasyncro/backend-core/services/redis.client.js', () => ({
  getRedisClient: () => ({ get: async () => null, set: async () => 'OK', del: async () => 0 }),
}));

const mockInitialSync = jest.fn();
const mockSmartSync = jest.fn();
const mockChannel = {
  consume: jest.fn().mockResolvedValue({ consumerTag: 'gh1101' }),
  cancel: jest.fn().mockResolvedValue(undefined),
  ack: jest.fn(),
  nack: jest.fn(),
  sendToQueue: jest.fn(),
};

import crypto from 'crypto';
import knexFactory, { type Knex } from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import {
  recordShopifySyncDispatchIntent,
  updateIntegrationStatus,
  type ShopifySyncExecutionAuthority,
} from 'api-src/services/shopify/shopifyIntegrationStatus.service';
import { dispatchShopifySyncIntentOnce } from 'api-src/workers/domain-event-outbox.dispatcher';
import { processSyncJob, startSyncWorker, stopSyncWorker } from 'api-src/sync.worker';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';

const SYNC_EVENT = 'integration/sync_dispatch_requested';
const app = createApp();
let admin: Knex | undefined;

type Status = 'PENDING' | 'FAILED' | 'COMPLETED' | 'SYNCING_PRODUCTS' | 'SYNCING_ORDERS';
type Fixture = {
  shopId: number; domain: string; integrationId: number; installationId: number;
  owner: number; authority: ShopifySyncExecutionAuthority;
};
type Message = { integrationId: number; intentDomainEventId: number };

async function fixture(label: string, options: { installation?: 'active' | 'uninstalled' | 'none';
  credential?: boolean } = {}): Promise<Fixture> {
  const { installation = 'active', credential = true } = options;
  const unique = crypto.randomUUID();
  const domain = `gh1101-${label}-${unique}.myshopify.com`;
  return systemTransaction(async trx => {
    const shopId = await createTenantShop(trx, `gh1101-recovery-${label}-${unique}`);
    await setTenantContext(trx, shopId);
    const [owner] = await trx('users').insert({ shop_id: shopId, role: 'owner',
      email: `gh1101-recovery-${label}-${unique}@test.invalid`, password_hash: 'synthetic' }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: owner.id, role: 'owner' });
    const [integration] = await trx('integrations').insert({ shop_id: shopId, platform: 'shopify',
      platform_shop_name: domain }).returning('id');
    let installationId = 0;
    if (installation !== 'none') {
      const [row] = await trx('shopify_app_installations').insert({ shop_id: shopId, shop_domain: domain,
        shop_gid: `gid://shopify/Shop/${shopId}`, scopes: SHOPIFY_REQUIRED_SCOPE_STRING,
        uninstalled_at: installation === 'uninstalled' ? new Date() : null }).returning('id');
      installationId = Number(row.id);
      if (credential) {
        const now = Date.now();
        await persistShopifyAdminCredentials(trx, installationId, shopId, {
          accessToken: `gh1101-access-${unique}`, refreshToken: `gh1101-refresh-${unique}`,
          accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
          grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING });
      }
    }
    return { shopId, domain, integrationId: Number(integration.id), installationId, owner: Number(owner.id),
      authority: { installationId, shopDomain: domain, generation: '0' } };
  });
}

async function moveTo(f: Fixture, target: Status) {
  if (target === 'PENDING') return;
  const write = (status: string) => updateIntegrationStatus({ integrationId: f.integrationId,
    shopId: f.shopId, status, executionAuthority: f.authority, error: status === 'FAILED' ? 'historical' : null });
  await write('SYNCING_PRODUCTS');
  if (target === 'SYNCING_PRODUCTS') return;
  if (target === 'FAILED') { await write('FAILED'); return; }
  await write('SYNCING_ORDERS');
  if (target === 'COMPLETED') await write('COMPLETED');
}

function post(f: Fixture, path: string, body: unknown = {}, shopId = f.shopId) {
  const token = issueTestToken({ userId: f.owner, shopId, roles: ['owner'] });
  return request(app).post(`/api/v1/integrations/${path}`).set('Authorization', `Bearer ${token}`).send(body);
}
const resync = (f: Fixture, id: number | string = f.integrationId) => post(f, `sync/${id}`);
const legacy = (f: Fixture) => post(f, 'manual-initial-sync', { shopId: f.shopId, integrationId: f.integrationId });

async function intents(f: Fixture) {
  return withTenant(f.shopId, trx => trx('domain_events').where({ shop_id: f.shopId, event_type: SYNC_EVENT })
    .select('id', 'event_payload').orderBy('id'));
}
async function startFacts(f: Fixture) {
  return withTenant(f.shopId, trx => trx('domain_events')
    .where({ shop_id: f.shopId, event_type: 'integration/sync_cycle_started' }).select('event_payload').orderBy('id'));
}
async function status(f: Fixture) {
  return (await withTenant(f.shopId, trx => trx('integrations').where({ id: f.integrationId })
    .first('sync_status'))).sync_status;
}
async function legacyEvents(f: Fixture) {
  return withTenant(f.shopId, trx => trx('domain_events')
    .where({ shop_id: f.shopId, event_type: 'integration/manual_sync_requested' }));
}

/** Dispatch through the real claim functions until this intent is published. */
async function dispatchUntil(intentId: number): Promise<Message> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    let sent: Message | undefined;
    const result = await dispatchShopifySyncIntentOnce(async message => { sent = message; });
    if (result.kind === 'IDLE') break;
    if (sent?.intentDomainEventId === intentId) return sent;
  }
  throw new Error(`GH1101_INTENT_NOT_DISPATCHED:${intentId}`);
}

async function dispatchedEver(intentId: number, f: Fixture) {
  const [row] = await withTenant(f.shopId, trx => trx('domain_event_outbox')
    .where({ domain_event_id: intentId }).select('id'));
  await admin!.raw(`UPDATE public.domain_event_outbox SET last_attempt_at = now() - interval '2 hours'
    WHERE id = ?`, [row.id]);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    let sent: Message | undefined;
    const result = await dispatchShopifySyncIntentOnce(async message => { sent = message; });
    if (result.kind === 'IDLE') return false;
    if (sent?.intentDomainEventId === intentId) return true;
  }
  return true;
}

function delivery(message: Message) {
  return { content: Buffer.from(JSON.stringify(message)) };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ||= 'gh1101-recovery-encryption-key-2026-012345';
  const database = process.env.PGDATABASE ?? '';
  if (process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(database)
    || !process.env.PGMIGRATION_USER || process.env.PGMIGRATION_USER === 'sf_app') {
    throw new Error('GH1101_REFUSING_UNSAFE_DB');
  }
  admin = knexFactory({ client: 'pg', pool: { min: 0, max: 1 }, connection: {
    host: process.env.PGHOST, port: Number(process.env.PGPORT), database,
    user: process.env.PGMIGRATION_USER, password: String(process.env.PGMIGRATION_PASSWORD || '') } });
  await startSyncWorker();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSmartSync.mockResolvedValue(undefined);
  mockInitialSync.mockResolvedValue(undefined);
});

afterAll(async () => {
  const results = await Promise.allSettled([stopSyncWorker(), admin?.destroy(), db.destroy()]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
});

describe('GH-1101 — manual recovery admission is durable and truthful', () => {
  it('POST /sync/:id on a FAILED integration commits one durable recovery intent (202), never an inert event', async () => {
    const f = await fixture('resync-failed');
    await moveTo(f, 'FAILED');
    const response = await resync(f);
    const rows = await intents(f);
    expect(response.status).toBe(202);
    expect(rows).toHaveLength(1);
    expect(response.body).toEqual({ status: 'SYNC_RECOVERY_REQUESTED', shopId: f.shopId,
      integrationId: f.integrationId, intentDomainEventId: Number(rows[0].id) });
    expect(rows[0].event_payload).toEqual({ integration_id: f.integrationId,
      installation_id: f.installationId, source: 'recovery' });
    expect(await legacyEvents(f)).toEqual([]);
    expect(mockInitialSync).not.toHaveBeenCalled();
    expect(await status(f)).toBe('FAILED');
  });

  it('the legacy /manual-initial-sync alias delegates to the same durable request and never runs sync inline', async () => {
    const f = await fixture('legacy-alias');
    await moveTo(f, 'FAILED');
    const response = await legacy(f);
    const rows = await intents(f);
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: 'SYNC_RECOVERY_REQUESTED', integrationId: f.integrationId,
      intentDomainEventId: Number(rows[0].id) });
    expect(mockInitialSync).not.toHaveBeenCalled();
    expect(await status(f)).toBe('FAILED');
  });

  it('the legacy alias can no longer race a running worker cycle', async () => {
    const f = await fixture('inline-race');
    await moveTo(f, 'SYNCING_ORDERS');
    const response = await legacy(f);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'SYNC_IN_PROGRESS', integrationId: f.integrationId });
    expect(mockInitialSync).not.toHaveBeenCalled();
    expect(await status(f)).toBe('SYNCING_ORDERS');
    expect(await intents(f)).toEqual([]);
  });

  it('a COMPLETED integration is refused truthfully on both routes with no implicit resync', async () => {
    const f = await fixture('completed');
    await moveTo(f, 'COMPLETED');
    for (const response of [await resync(f), await legacy(f)]) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'SYNC_ALREADY_COMPLETED', integrationId: f.integrationId });
    }
    expect(await intents(f)).toEqual([]);
    expect(await status(f)).toBe('COMPLETED');
  });

  it('duplicate and concurrent requests produce exactly one outstanding intent', async () => {
    const f = await fixture('duplicate');
    await moveTo(f, 'FAILED');
    expect((await resync(f)).status).toBe(202);
    const second = await resync(f);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: 'SYNC_ALREADY_REQUESTED', integrationId: f.integrationId });

    const g = await fixture('concurrent');
    await moveTo(g, 'FAILED');
    const responses = await Promise.all([resync(g), legacy(g), resync(g)]);
    expect(responses.map(response => response.status).sort()).toEqual([202, 409, 409]);
    expect(await intents(g)).toHaveLength(1);
  });

  it('an unusable connection is refused specifically, with no intent and no provider call', async () => {
    const cases: Array<[string, Parameters<typeof fixture>[1], Record<string, unknown> | null, string]> = [
      ['not-installed', { installation: 'none' }, null, 'SHOPIFY_NOT_INSTALLED'],
      ['uninstalled', { installation: 'uninstalled' }, null, 'SHOPIFY_UNINSTALLED'],
      ['no-credential', { credential: false }, null, 'SHOPIFY_REAUTH_REQUIRED'],
      ['reauth', {}, { credential_state: 'REAUTH_REQUIRED' }, 'SHOPIFY_REAUTH_REQUIRED'],
      ['reconnecting', {}, { credential_state: 'REAUTH_REQUIRED', rotation_lease_token: crypto.randomUUID(),
        rotation_lease_expires_at: new Date(Date.now() + 3_600_000), rotation_started_at: new Date() },
        'SHOPIFY_RECONNECT_IN_PROGRESS'],
    ];
    for (const [label, options, credential, code] of cases) {
      const f = await fixture(label, options);
      if (credential) {
        await withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId })
          .update(credential));
      }
      const response = await resync(f);
      expect([label, response.status, response.body]).toEqual([label, 409,
        { error: code, integrationId: f.integrationId }]);
      expect(await intents(f)).toEqual([]);
    }
  });

  it('identifiers are validated and foreign integrations are invisible', async () => {
    const f = await fixture('validation');
    await moveTo(f, 'FAILED');
    for (const id of ['abc', '0', '-3', '1.5']) {
      const response = await resync(f, id);
      expect([id, response.status, response.body]).toEqual([id, 400, { error: 'INVALID_INTEGRATION_ID' }]);
    }
    const other = await fixture('foreign');
    await moveTo(other, 'FAILED');
    const response = await resync(f, other.integrationId);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'INTEGRATION_NOT_FOUND', integrationId: other.integrationId });
    expect(await intents(f)).toEqual([]);
    expect(await intents(other)).toEqual([]);
  });

  it('a stranded PENDING integration without an outstanding intent can be re-requested once', async () => {
    const f = await fixture('stranded-pending');
    expect((await resync(f)).status).toBe(202);
    expect((await resync(f)).status).toBe(409);
    expect(await intents(f)).toHaveLength(1);
  });
});

describe('GH-1101 — explicit FAILED recovery through the durable pipeline', () => {
  it('a recovery intent starts exactly one fresh cycle; only a new explicit request can start another', async () => {
    const f = await fixture('end-to-end');
    await moveTo(f, 'FAILED');
    const first = await resync(f);
    expect(first.status).toBe(202);
    const firstIntent = first.body.intentDomainEventId as number;

    const message = await dispatchUntil(firstIntent);
    expect(message).toEqual({ integrationId: f.integrationId, intentDomainEventId: firstIntent });
    await processSyncJob(delivery(message));
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(await status(f)).toBe('SYNCING_PRODUCTS');
    expect(await startFacts(f)).toEqual([{ event_payload: { integration_id: f.integrationId,
      intent_domain_event_id: firstIntent } }]);

    // The recovered cycle fails again: neither redelivery nor redispatch restarts it.
    await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId, status: 'FAILED',
      executionAuthority: f.authority, error: 'synthetic-recovery-failure' });
    await processSyncJob(delivery(message));
    expect(await dispatchedEver(firstIntent, f)).toBe(false);
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
    expect(await status(f)).toBe('FAILED');

    // A fresh explicit request is the only way to start another recovery.
    const second = await resync(f);
    expect(second.status).toBe(202);
    const secondIntent = second.body.intentDomainEventId as number;
    expect(secondIntent).toBeGreaterThan(firstIntent);
    await processSyncJob(delivery(await dispatchUntil(secondIntent)));
    expect(mockSmartSync).toHaveBeenCalledTimes(2);
    expect((await startFacts(f)).map(fact => fact.event_payload.intent_domain_event_id))
      .toEqual([firstIntent, secondIntent]);
  });

  it('an outstanding bootstrap intent blocks a duplicate request; a consumed one does not', async () => {
    const f = await fixture('bootstrap-outstanding');
    await moveTo(f, 'FAILED');
    await withTenant(f.shopId, trx => recordShopifySyncDispatchIntent(trx, { shopId: f.shopId,
      integrationId: f.integrationId, installationId: f.installationId }));
    const [installIntent] = await intents(f);
    const blocked = await resync(f);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('SYNC_ALREADY_REQUESTED');
    await processSyncJob(delivery({ integrationId: f.integrationId, intentDomainEventId: Number(installIntent.id) }));
    await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId, status: 'FAILED',
      executionAuthority: f.authority, error: 'bootstrap-cycle-failed' });
    expect((await resync(f)).status).toBe(202);
  });

  it('a request racing a worker-claimed cycle is refused and never starts a second cycle', async () => {
    const f = await fixture('worker-race');
    await moveTo(f, 'FAILED');
    const accepted = await resync(f);
    await processSyncJob(delivery({ integrationId: f.integrationId,
      intentDomainEventId: accepted.body.intentDomainEventId }));
    expect(await status(f)).toBe('SYNCING_PRODUCTS');
    const raced = await resync(f);
    expect(raced.status).toBe(409);
    expect(raced.body.error).toBe('SYNC_IN_PROGRESS');
    expect(await startFacts(f)).toHaveLength(1);
    expect(mockSmartSync).toHaveBeenCalledTimes(1);
  });
});
