// tests/unit/specter/sync.worker.test.ts
/**
 * TDD tests for sync.worker.processSyncJob
 *
 * Scenarios:
 *  - successful sync -> performSmartSync called, message acked
 *  - invalid JSON -> nack(msg, false, false)
 *  - missing integrationId -> ack(msg)
 *  - invalid integration (missing fields) -> db update called, nack(msg)
 *
 * NOTE: we mock ./queue early so the module's top-level getQueueChannel() call
 * (which runs at import time) resolves to our test channel.
 */

import CryptoJS from 'crypto-js';

describe('sync.worker.processSyncJob', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Ensure encryption key is present for decryptToken()
    process.env.ENCRYPTION_KEY = 'test-secret-123';
  });

  test('successful sync -> performSmartSync called and ack', async () => {
    // Prepare an encrypted token using CryptoJS so decryptToken() works
    const plainToken = 'ACCESS_TOKEN_X';
    const encryptedToken = CryptoJS.AES.encrypt(plainToken, process.env.ENCRYPTION_KEY!).toString();

    // Mock queue channel (top-level import side-effect uses this)
    const mockAck = jest.fn();
    const mockNack = jest.fn();
    const mockChannel = {
      ack: mockAck,
      nack: mockNack,
      consume: jest.fn(),
      // the worker uses syncChannel.* directly so ack/nack are enough
    };
    jest.doMock('api-src/queue', () => ({
      getQueueChannel: () => mockChannel
    }));

    // Mock db: when called with 'integrations' return a chainable object
    const mockFirst = jest.fn().mockResolvedValue({
      id: 99,
      shop_id: 42,
      platform: 'shopify',
      platform_shop_name: 'my-shop',
      access_token_encrypted: encryptedToken
    });
    const mockWhere = jest.fn().mockReturnValue({ first: mockFirst, update: jest.fn().mockResolvedValue(1) });
    const mockDb = jest.fn((table: string) => {
      if (table === 'integrations') {
        return { where: mockWhere };
      }
      // default: return noopable chain
      return { where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) }) };
    });
    jest.doMock('api-src/db', () => mockDb);

    // Mock performSmartSync
    const performSmartSync = jest.fn().mockResolvedValue(undefined);
    jest.doMock('api-src/services/shopify-sync-orchestrator.service', () => ({ performSmartSync }));

    // Now import the module under test (after all mocks)
    const { processSyncJob } = await import('api-src/sync.worker');

    // Build message with integrationId
    const payload = { integrationId: 99 };
    const msg = { content: Buffer.from(JSON.stringify(payload)) };

    await processSyncJob(msg as any);

    // performSmartSync should have been called with decrypted token and correct args
    expect(performSmartSync).toHaveBeenCalledWith(
      plainToken,
      'my-shop',
      42,
      99
    );

    // ack should be called (nack should not)
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockNack).not.toHaveBeenCalled();
  });

  test('invalid JSON -> nack called with requeue=false', async () => {
    const mockAck = jest.fn();
    const mockNack = jest.fn();
    const mockChannel = { ack: mockAck, nack: mockNack, consume: jest.fn() };
    jest.doMock('api-src/queue', () => ({ getQueueChannel: () => mockChannel }));
    jest.doMock('api-src/db', () => jest.fn());
    jest.doMock('api-src/services/shopify-sync-orchestrator.service', () => ({ performSmartSync: jest.fn() }));

    const { processSyncJob } = await import('api-src/sync.worker');

    const badMsg = { content: Buffer.from('this is not json') };
    await processSyncJob(badMsg as any);

    expect(mockNack).toHaveBeenCalledWith(badMsg as any, false, false);
    expect(mockAck).not.toHaveBeenCalled();
  });

  test('missing integrationId -> ack and no sync', async () => {
    const mockAck = jest.fn();
    const mockNack = jest.fn();
    const mockChannel = { ack: mockAck, nack: mockNack, consume: jest.fn() };
    jest.doMock('api-src/queue', () => ({ getQueueChannel: () => mockChannel }));

    // db should not be consulted for integrations in this path, but provide a noop
    jest.doMock('api-src/db', () => jest.fn());
    const performSmartSync = jest.fn();
    jest.doMock('api-src/services/shopify-sync-orchestrator.service', () => ({ performSmartSync }));

    const { processSyncJob } = await import('api-src/sync.worker');

    const payload = { someOther: 'value' }; // missing integrationId
    const msg = { content: Buffer.from(JSON.stringify(payload)) };

    await processSyncJob(msg as any);

    expect(mockAck).toHaveBeenCalled();
    expect(performSmartSync).not.toHaveBeenCalled();
  });

  test('invalid integration -> updates db and nacks', async () => {
    const mockAck = jest.fn();
    const mockNack = jest.fn();
    const mockChannel = { ack: mockAck, nack: mockNack, consume: jest.fn() };
    jest.doMock('api-src/queue', () => ({ getQueueChannel: () => mockChannel }));

    // integration missing required fields (e.g., platform missing)
    const incompleteIntegration = { id: 77, shop_id: 10, platform: 'shopify' /* intentionally missing access_token_encrypted */ };
    const mockFirst = jest.fn().mockResolvedValue(incompleteIntegration);
    // we must provide an update() on the where(...) chain
    const mockUpdate = jest.fn().mockResolvedValue(1);
    const mockWhereObj = { first: mockFirst, update: mockUpdate };
    const mockWhere = jest.fn().mockReturnValue(mockWhereObj);
    const mockDb = jest.fn((table: string) => (table === 'integrations' ? { where: mockWhere } : { where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) }) }));
    jest.doMock('api-src/db', () => mockDb);

    jest.doMock('api-src/services/shopify-sync-orchestrator.service', () => ({ performSmartSync: jest.fn() }));

    const { processSyncJob } = await import('api-src/sync.worker');

    const msg = { content: Buffer.from(JSON.stringify({ integrationId: 77 })) };

    await processSyncJob(msg as any);

    // update should be called to mark sync failed
    expect(mockUpdate).toHaveBeenCalledWith({
      sync_status: 'FAILED',
      sync_last_error: expect.any(String),
    });

    expect(mockNack).toHaveBeenCalledWith(msg as any, false, false);
    expect(mockAck).not.toHaveBeenCalled();
  });
});
