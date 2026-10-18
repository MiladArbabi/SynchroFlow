/**
 * GH-1068 T3-B — sync worker intent gate and dispatcher publish ordering.
 *
 * Unit-only: no RabbitMQ, PostgreSQL, or Shopify provider. Real-DB claim,
 * fence and outbox semantics are owned by
 * tests/integration/lifecycle/gh1068-t3b-durable-sync-dispatch.test.ts.
 */

const mockSystemQuery = jest.fn();
const mockCredential = jest.fn();
const mockSmartSync = jest.fn();
const mockWriteStatus = jest.fn();
const mockClaimCycle = jest.fn();
const mockSendToQueue = jest.fn();

const mockChannel = {
  consume: jest.fn().mockResolvedValue({ consumerTag: 't3b-test' }),
  cancel: jest.fn().mockResolvedValue(undefined),
  ack: jest.fn(),
  nack: jest.fn(),
  sendToQueue: (...args: any[]) => mockSendToQueue(...args),
};

const mockIntegrationQuery = {
  where: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  first: jest.fn(),
};

jest.mock('api-src/queue', () => ({
  getQueueChannel: () => mockChannel,
}));

jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: { raw: jest.fn((sql: string, bindings?: unknown[]) => ({ sql, bindings })) },
  systemQuery: (...args: any[]) => mockSystemQuery(...args),
  withTenant: (_shopId: number, callback: (trx: any) => unknown) =>
    callback((table: string) => {
      if (table !== 'integrations') throw new Error(`UNEXPECTED_TABLE:${table}`);
      return mockIntegrationQuery;
    }),
}));

jest.mock('api-src/services/shopify/shopifyAdminCredentialConsumer.service', () => ({
  resolveShopifyAdminCredentialForConsumer: (...args: any[]) => mockCredential(...args),
}));

jest.mock('api-src/services/shopify-sync-orchestrator.service', () => ({
  performSmartSync: (...args: any[]) => mockSmartSync(...args),
}));

jest.mock('api-src/services/shopify/shopifyIntegrationStatus.service', () => ({
  updateIntegrationStatus: (...args: any[]) => mockWriteStatus(...args),
  claimShopifySyncCycle: (...args: any[]) => mockClaimCycle(...args),
}));

jest.mock('api-src/api/billing/stripe.meter.service', () => ({
  deliverStripeOverageEvent: jest.fn(),
}));

jest.mock('api-src/api/billing/shopify.events.service', () => ({
  deliverShopifyOverageEvent: jest.fn(),
}));

import { processSyncJob, startSyncWorker } from 'api-src/sync.worker';
import {
  dispatchShopifySyncIntentOnce,
  publishShopifySyncJob,
} from 'api-src/workers/domain-event-outbox.dispatcher';

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

describe('GH-1068 T3-B — sync worker intent gate', () => {
  const shopId = 23;
  const integrationId = 29;
  const intentDomainEventId = 31;
  const shopDomain = 't3b-worker.myshopify.com';
  const authority = { installationId: 5, shopDomain, generation: '8' };
  const delivery = (message: Record<string, unknown> = { integrationId, intentDomainEventId }) =>
    ({ content: Buffer.from(JSON.stringify(message)) });

  beforeAll(async () => {
    await Promise.resolve(startSyncWorker());
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSystemQuery.mockResolvedValue({ rows: [{ shop_id: shopId }] });
    mockIntegrationQuery.first.mockResolvedValue({ id: integrationId, shop_id: shopId,
      platform: 'shopify', platform_shop_name: shopDomain });
    mockCredential.mockResolvedValue({ kind: 'READY', accessToken: 'test-token', ...authority });
    mockClaimCycle.mockResolvedValue({ kind: 'CLAIMED' });
    mockSmartSync.mockResolvedValue(undefined);
    mockWriteStatus.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['missing', { integrationId }],
    ['zero', { integrationId, intentDomainEventId: 0 }],
    ['string', { integrationId, intentDomainEventId: String(intentDomainEventId) }],
    ['fractional', { integrationId, intentDomainEventId: 1.5 }],
  ])('a %s intent identity is acknowledged without authority, claim or writes', async (_label, message) => {
    await processSyncJob(delivery(message));
    expect(mockSystemQuery).not.toHaveBeenCalled();
    expect(mockCredential).not.toHaveBeenCalled();
    expect(mockClaimCycle).not.toHaveBeenCalled();
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect(mockWriteStatus).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('claims the exact intent under the current authority before launching sync', async () => {
    await processSyncJob(delivery());
    expect(mockClaimCycle).toHaveBeenCalledWith({ integrationId, shopId, intentDomainEventId,
      executionAuthority: authority });
    expect(mockSmartSync).toHaveBeenCalledWith('test-token', shopDomain, shopId, integrationId, authority);
    expect(mockClaimCycle.mock.invocationCallOrder[0])
      .toBeLessThan(mockSmartSync.mock.invocationCallOrder[0]);
    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('a rejected (stale, duplicate or non-PENDING) intent is acknowledged without sync or writes', async () => {
    mockClaimCycle.mockResolvedValueOnce({ kind: 'REJECTED' });
    await processSyncJob(delivery());
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect(mockWriteStatus).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('a fenced (stale-authority) claim is acknowledged without sync or a FAILED write', async () => {
    mockClaimCycle.mockRejectedValueOnce(new Error('SHOPIFY_SYNC_STALE_AUTHORITY'));
    await processSyncJob(delivery());
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect(mockWriteStatus).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it.each(['REFRESH_IN_PROGRESS', 'RETRYABLE'])(
    'temporary %s credentials never claim or write; the durable intent is left to the dispatcher',
    async kind => {
      mockCredential.mockResolvedValueOnce({ kind });
      await processSyncJob(delivery());
      expect(mockClaimCycle).not.toHaveBeenCalled();
      expect(mockSmartSync).not.toHaveBeenCalled();
      expect(mockWriteStatus).not.toHaveBeenCalled();
      expect(mockSystemQuery).toHaveBeenCalledTimes(1);
      expect(mockChannel.ack.mock.calls.length + mockChannel.nack.mock.calls.length).toBe(1);
    });

  it('an unexpected claim error writes nothing and reaches exactly one NACK', async () => {
    mockClaimCycle.mockRejectedValueOnce(new Error('synthetic database outage'));
    await processSyncJob(delivery());
    expect(mockSmartSync).not.toHaveBeenCalled();
    expect(mockWriteStatus).not.toHaveBeenCalled();
    expect(mockChannel.ack).not.toHaveBeenCalled();
    expect(mockChannel.nack).toHaveBeenCalledTimes(1);
  });
});

describe('GH-1068 T3-B — dispatcher publish ordering', () => {
  const claimRow = { outbox_id: '41', domain_event_id: '43', shop_id: 47, integration_id: 53,
    retry_count: 0, recovery: false };
  const statements = () => mockSystemQuery.mock.calls.map(([query]) => String(query.sql));

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSystemQuery.mockImplementation(async (query: { sql: string }) => {
      if (query.sql.includes('claim_shopify_sync_dispatch_outbox')) return { rows: [claimRow] };
      return { rows: [{ ok: true }] };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('is idle when no intent is eligible', async () => {
    mockSystemQuery.mockResolvedValueOnce({ rows: [] });
    const publish = jest.fn();
    expect(await dispatchShopifySyncIntentOnce(publish)).toEqual({ kind: 'IDLE' });
    expect(publish).not.toHaveBeenCalled();
    expect(statements()).toHaveLength(1);
  });

  it('marks published only after the broker confirmation settles', async () => {
    const confirmation = deferred();
    const publish = jest.fn(() => confirmation.promise as Promise<void>);
    const dispatching = dispatchShopifySyncIntentOnce(publish);
    await flush();
    expect(publish).toHaveBeenCalledWith({ integrationId: 53, intentDomainEventId: 43 });
    expect(statements().some(sql => sql.includes('mark_shopify_sync_dispatch_outbox_published'))).toBe(false);
    confirmation.resolve();
    expect(await dispatching).toEqual({ kind: 'PUBLISHED', outboxId: 41, intentDomainEventId: 43,
      integrationId: 53, shopId: 47, recovery: false });
    const marked = mockSystemQuery.mock.calls.find(([query]) =>
      String(query.sql).includes('mark_shopify_sync_dispatch_outbox_published'));
    expect(marked?.[0].bindings).toEqual([41]);
    expect(statements().some(sql => sql.includes('record_shopify_sync_dispatch_outbox_failure'))).toBe(false);
  });

  it('records an unconfirmed publish as a retryable failure and never marks it published', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('timeout'));
    expect(await dispatchShopifySyncIntentOnce(publish)).toMatchObject({ kind: 'PUBLISH_REJECTED',
      intentDomainEventId: 43 });
    const recorded = mockSystemQuery.mock.calls.find(([query]) =>
      String(query.sql).includes('record_shopify_sync_dispatch_outbox_failure'));
    expect(recorded?.[0].bindings).toEqual([41, 'timeout']);
    expect(statements().some(sql => sql.includes('mark_shopify_sync_dispatch_outbox_published'))).toBe(false);
  });

  it('the default publisher sends one persistent sync_jobs message and awaits its confirmation', async () => {
    const confirmation = deferred();
    mockSendToQueue.mockReturnValueOnce(confirmation.promise);
    let settled = false;
    const publishing = publishShopifySyncJob({ integrationId: 53, intentDomainEventId: 43 })
      .then(() => { settled = true; });
    await flush();
    expect(mockSendToQueue).toHaveBeenCalledTimes(1);
    const [queue, content, options] = mockSendToQueue.mock.calls[0];
    expect(queue).toBe('sync_jobs');
    expect(JSON.parse(content.toString())).toEqual({ integrationId: 53, intentDomainEventId: 43 });
    expect(options).toMatchObject({ persistent: true });
    expect(Number.isSafeInteger(options.timeout) && options.timeout > 0).toBe(true);
    expect(settled).toBe(false);
    confirmation.resolve(true);
    await publishing;
    expect(settled).toBe(true);
  });

  it('the default publisher propagates a broker rejection', async () => {
    mockSendToQueue.mockImplementationOnce(() => Promise.reject(new Error('Channel closed')));
    await expect(publishShopifySyncJob({ integrationId: 53, intentDomainEventId: 43 }))
      .rejects.toThrow('Channel closed');
  });
});

describe('GH-1068 T3-B — protected T3-A migrations remain immutable', () => {
  // SHA-256 of the certified T3-A files at f3b287c52c2b65e2bcf13137b17382194beb89ff.
  it.each([
    ['20261016120000_0212_authorize_shopify_reconnect_sync_reset.ts',
      '793866b73c5b9092be3b3afeefa2fdbabf5ce552e62bd33ffd7c85bcdeaeda22'],
    ['20261016150000_0215_harden_reconnect_and_priority_function_authority.ts',
      '39456ed4ecb0697c20d2926a380cbb4190c982df91667225014506d26d749fd1'],
  ])('%s is byte-identical to the certified file', (file, sha256) => {
    const { createHash } = jest.requireActual('crypto') as typeof import('crypto');
    const { readFileSync } = jest.requireActual('fs') as typeof import('fs');
    const { join } = jest.requireActual('path') as typeof import('path');
    const content = readFileSync(join(__dirname, '../../../../apps/backend/migrations', file));
    expect(createHash('sha256').update(content).digest('hex')).toBe(sha256);
  });
});
