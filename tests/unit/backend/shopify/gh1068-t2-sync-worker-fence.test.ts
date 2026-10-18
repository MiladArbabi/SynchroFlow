/**
 * GH-1068 T2 — queue-worker execution authority.
 *
 * Unit-only: no RabbitMQ, PostgreSQL, or Shopify provider.
 * B4 consumer lifecycle implementation remains untouched.
 */

const mockSystemQuery = jest.fn();
const mockCredential = jest.fn();
const mockSmartSync = jest.fn();
const mockWriteStatus = jest.fn();
const mockClaimCycle = jest.fn();

const mockChannel = {
  consume: jest.fn().mockResolvedValue({ consumerTag: 't2-test' }),
  cancel: jest.fn().mockResolvedValue(undefined),
  ack: jest.fn(),
  nack: jest.fn(),
};

const mockIntegrationQuery = {
  where: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  first: jest.fn(),
  update: jest.fn().mockResolvedValue(1),
};

const mockWithTenant = jest.fn(
  (_shopId: number, callback: (trx: any) => unknown) =>
    callback((table: string) => {
      if (table !== 'integrations') {
        throw new Error(`UNEXPECTED_TABLE:${table}`);
      }
      return mockIntegrationQuery;
    }),
);

jest.mock('api-src/queue', () => ({
  getQueueChannel: () => mockChannel,
}));

jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: { raw: jest.fn(() => ({})) },
  systemQuery: (...args: any[]) => mockSystemQuery(...args),
  withTenant: (...args: any[]) => mockWithTenant(...args),
}));

jest.mock(
  'api-src/services/shopify/shopifyAdminCredentialConsumer.service',
  () => ({
    resolveShopifyAdminCredentialForConsumer: (...args: any[]) =>
      mockCredential(...args),
  }),
);

jest.mock('api-src/services/shopify-sync-orchestrator.service', () => ({
  performSmartSync: (...args: any[]) => mockSmartSync(...args),
}));

jest.mock(
  'api-src/services/shopify/shopifyIntegrationStatus.service',
  () => ({
    updateIntegrationStatus: (...args: any[]) =>
      mockWriteStatus(...args),
    // GH-1068 T3-B: the fenced single-flight cycle claim precedes sync.
    claimShopifySyncCycle: (...args: any[]) => mockClaimCycle(...args),
  }),
);

import {
  processSyncJob,
  startSyncWorker,
} from 'api-src/sync.worker';

describe('GH-1068 T2 — sync worker generation fence', () => {
  const shopId = 17;
  const integrationId = 19;
  const shopDomain = 't2-worker.myshopify.com';

  const authority = {
    installationId: 5,
    shopDomain,
    generation: '4',
  };

  // GH-1068 T3-B: every sync_jobs message names its exact durable intent.
  const delivery = () => ({
    content: Buffer.from(JSON.stringify({ integrationId, intentDomainEventId: 37 })),
  });

  beforeAll(async () => {
    await Promise.resolve(startSyncWorker());
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockSystemQuery.mockResolvedValue({
      rows: [{ shop_id: shopId }],
    });

    mockIntegrationQuery.first.mockResolvedValue({
      id: integrationId,
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
    });

    mockIntegrationQuery.update.mockResolvedValue(1);

    mockCredential.mockResolvedValue({
      kind: 'READY',
      accessToken: 'test-token',
      ...authority,
    });

    mockSmartSync.mockResolvedValue(undefined);
    mockWriteStatus.mockResolvedValue(undefined);
    mockClaimCycle.mockResolvedValue({ kind: 'CLAIMED' });
  });

  it('dispatches the original credential generation', async () => {
    await processSyncJob(delivery());

    expect(mockSmartSync).toHaveBeenCalledWith(
      'test-token',
      shopDomain,
      shopId,
      integrationId,
      authority,
    );

    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('does not mark an uninstalled stale job FAILED', async () => {
    mockSmartSync.mockRejectedValueOnce(
      new Error('SHOPIFY_SYNC_STALE_AUTHORITY'),
    );

    await processSyncJob(delivery());

    expect(mockIntegrationQuery.update).not.toHaveBeenCalled();
    expect(mockWriteStatus).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  it('does not write FAILED without READY credentials', async () => {
    mockCredential.mockResolvedValueOnce({
      kind: 'REAUTH_REQUIRED',
    });

    await processSyncJob(delivery());

    expect(mockSmartSync).not.toHaveBeenCalled();
    expect(mockIntegrationQuery.update).not.toHaveBeenCalled();
    expect(mockWriteStatus).not.toHaveBeenCalled();
  });

  it('routes genuine sync failures through the fenced writer', async () => {
    mockSmartSync.mockRejectedValueOnce(
      new Error('provider failure'),
    );

    await processSyncJob(delivery());

    expect(mockIntegrationQuery.update).not.toHaveBeenCalled();

    expect(mockWriteStatus).toHaveBeenCalledWith({
      integrationId,
      shopId,
      status: 'FAILED',
      error: 'provider failure',
      executionAuthority: authority,
    });

    expect(mockChannel.nack).toHaveBeenCalledTimes(1);
  });
});
