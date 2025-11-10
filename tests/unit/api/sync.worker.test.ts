import { getQueueChannel } from 'api-src/queue';
import db from 'api-src/db';
import CryptoJS from 'crypto-js';
import { performInitialSync } from 'api-src/services/shopify.service';

// Mock dependencies
jest.mock('api-src/queue');
jest.mock('api-src/db');
jest.mock('crypto-js');
jest.mock('api-src/services/shopify.service');

// Mock console methods for observability tests
const originalConsole = { ...console };
const mockConsole = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};

describe('Sync Worker', () => {
  const mockChannel = {
    ack: jest.fn(),
    nack: jest.fn(),
    consume: jest.fn(),
    close: jest.fn(),
  };

  const mockIntegration = {
    id: 123,
    shop_id: 456,
    platform: 'shopify',
    platform_shop_name: 'test-shop.myshopify.com',
    access_token_encrypted: 'encrypted-token-123'
  };

  const woocommerceIntegration = {
    ...mockIntegration,
    platform: 'woocommerce'
  };

    // Mock database query builder methods
    const mockWhere = jest.fn().mockReturnThis();
    const mockFirst = jest.fn();
    const mockUpdate = jest.fn().mockResolvedValue(1);

  beforeEach(() => {
    jest.clearAllMocks();
    (getQueueChannel as jest.Mock).mockReturnValue(mockChannel);
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    
    // Setup default db mock
    (db as jest.MockedFunction<any>).mockImplementation((table: string) => {
      if (table === 'integrations') {
        return {
          where: mockWhere,
          first: mockFirst,
          update: mockUpdate
        };
      }
      return {
        where: mockWhere,
        first: mockFirst
      };
    });
    
    // Restore console if it was mocked
    global.console = originalConsole;
  });

  afterAll(() => {
    global.console = originalConsole;
  });

  // ===== CORE FUNCTIONALITY TESTS =====
  describe('Core Functionality', () => {
    it('should process valid message successfully (Happy Path)', async () => {
      // Setup mocks
      mockFirst.mockResolvedValue(mockIntegration);
      
      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });
      
      (performInitialSync as jest.Mock).mockResolvedValue(undefined);

      // Import worker
      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      // Execute
      await processSyncJob(mockMsg);

      // Verify
      expect(db).toHaveBeenCalledWith('integrations');
      expect(mockWhere).toHaveBeenCalledWith({ id: 123 });
      expect(CryptoJS.AES.decrypt).toHaveBeenCalledWith('encrypted-token-123', 'test-encryption-key');
      expect(performInitialSync).toHaveBeenCalledWith(
        'decrypted-access-token', 
        'test-shop.myshopify.com', 
        456,
        123  // integrationId is now passed
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should handle null message gracefully', async () => {
      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      await processSyncJob(null);

      expect(db).not.toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });
  });

  // ===== SECURITY & VALIDATION TESTS =====
  describe('Security & Validation', () => {
    it('should handle missing integrationId in message', async () => {
      (getQueueChannel as jest.Mock).mockReturnValue(mockChannel);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ someOtherField: 'value' })) };

      await processSyncJob(mockMsg);

      expect(db).not.toHaveBeenCalled();
      expect(performInitialSync).not.toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should handle invalid JSON in message', async () => {
      (getQueueChannel as jest.Mock).mockReturnValue(mockChannel);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from('invalid json {') };

      await processSyncJob(mockMsg);

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    });

    it('should handle missing ENCRYPTION_KEY environment variable', async () => {
      delete process.env.ENCRYPTION_KEY;
      
      mockFirst.mockResolvedValue(mockIntegration);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
      expect(performInitialSync).not.toHaveBeenCalled();
    });

    it('should handle token decryption failures', async () => {
      mockFirst.mockResolvedValue(mockIntegration);

      // Mock decryption to throw error
      (CryptoJS.AES.decrypt as jest.Mock).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
      expect(performInitialSync).not.toHaveBeenCalled();
    });

    it('should handle malformed integration data', async () => {
      const malformedIntegration = {
        id: 123,
        // Missing required fields: shop_id, platform_shop_name, access_token_encrypted
        platform: 'shopify'
      };

      // Make sure we're using the shared mocks
      mockFirst.mockResolvedValue(malformedIntegration);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      // Should nack due to missing required fields
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
      
      // Verify integration status was updated
      expect(mockUpdate).toHaveBeenCalledWith({
        sync_status: 'FAILED',
        sync_last_error: expect.stringContaining('Integration missing required fields')
      });
    });
  });

  // ===== ERROR HANDLING TESTS =====
  describe('Error Handling', () => {
    it('should handle service failure with nack and update integration status', async () => {
    mockFirst.mockResolvedValue(mockIntegration);

    (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
      toString: jest.fn().mockReturnValue('decrypted-access-token')
    });

    const syncError = new Error('Shopify API unavailable');
    (performInitialSync as jest.Mock).mockRejectedValue(syncError);

    let processSyncJob: any;
    await jest.isolateModules(async () => {
      const worker = require('api-src/sync.worker');
      processSyncJob = worker.processSyncJob;
    });

    const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

    await processSyncJob(mockMsg);

    expect(performInitialSync).toHaveBeenCalled();
    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    
    // Verify integration status is updated on failure
    expect(mockUpdate).toHaveBeenCalledWith({
      sync_status: 'FAILED',
      sync_last_error: 'Shopify API unavailable' // This should match the actual error
    });
  });

  // Fix for "should handle database connection failures"
  it('should handle database connection failures', async () => {
    // Mock database to throw connection error ONLY for the initial query
    // But allow the update in the catch block to work so the test can complete
    let shouldThrow = true;
    (db as jest.MockedFunction<any>).mockImplementation((_table: string) => {
      if (shouldThrow) {
        shouldThrow = false; // Only throw on the first call (the query)
        throw new Error('Database connection failed');
      }
      // For subsequent calls (like the update in catch block), return a working mock
      return {
        where: jest.fn().mockReturnThis(),
        update: jest.fn().mockResolvedValue(1)
      };
    });

    let processSyncJob: any;
    await jest.isolateModules(async () => {
      const worker = require('api-src/sync.worker');
      processSyncJob = worker.processSyncJob;
    });

    const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

    await processSyncJob(mockMsg);

    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    expect(performInitialSync).not.toHaveBeenCalled();
  });

  // Fix for "should handle database constraint violations"
  it('should handle database constraint violations', async () => {
    // Use the shared mocks instead of creating new ones
    mockFirst.mockResolvedValue(mockIntegration);

    (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
      toString: jest.fn().mockReturnValue('decrypted-access-token')
    });

    // Mock sync service to throw constraint error
    const constraintError = new Error('Unique constraint violation');
    (performInitialSync as jest.Mock).mockRejectedValue(constraintError);

    let processSyncJob: any;
    await jest.isolateModules(async () => {
      const worker = require('api-src/sync.worker');
      processSyncJob = worker.processSyncJob;
    });

    const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

    await processSyncJob(mockMsg);

    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    // Also verify the integration status was updated
    expect(mockUpdate).toHaveBeenCalledWith({
      sync_status: 'FAILED',
      sync_last_error: 'Unique constraint violation'
    });
  });
});

  // ===== PLATFORM EXPANSION TESTS =====
  describe('Platform Support', () => {
    it('should handle woocommerce platform gracefully', async () => {
      // Use the shared mocks
      mockFirst.mockResolvedValue(woocommerceIntegration);

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      // Mock console.warn to test the warning message
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      expect(performInitialSync).not.toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No sync logic implemented for platform: woocommerce')
      );

      consoleWarnSpy.mockRestore();
    });

    // Fix for "should be easily extendable for new platforms"
    it('should be easily extendable for new platforms', async () => {
      // Use the shared mocks
      const newPlatformIntegration = {
        ...mockIntegration,
        platform: 'bigcommerce'
      };
      mockFirst.mockResolvedValue(newPlatformIntegration);

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      // New platform should be handled gracefully (ack but no sync)
      expect(performInitialSync).not.toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  // ===== PERFORMANCE & RESILIENCE TESTS =====
  describe('Performance & Resilience', () => {
    it('should handle very large message payloads', async () => {
      mockFirst.mockResolvedValue(mockIntegration);

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      (performInitialSync as jest.Mock).mockResolvedValue(undefined);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      // Create a large payload
      const largeData = 'x'.repeat(10000);
      const largePayload = { integrationId: 123, largeData, timestamp: Date.now() };
      const mockMsg = { content: Buffer.from(JSON.stringify(largePayload)) };

      await processSyncJob(mockMsg);

      // Should process without issues
      expect(performInitialSync).toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });

    it('should process multiple consecutive sync jobs', async () => {
      mockFirst.mockResolvedValue(mockIntegration);

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      (performInitialSync as jest.Mock).mockResolvedValue(undefined);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      // Process multiple messages
      const messages = [
        { content: Buffer.from(JSON.stringify({ integrationId: 123 })) },
        { content: Buffer.from(JSON.stringify({ integrationId: 124 })) },
        { content: Buffer.from(JSON.stringify({ integrationId: 125 })) },
      ];

      for (const msg of messages) {
        await processSyncJob(msg);
      }

      expect(performInitialSync).toHaveBeenCalledTimes(3);
      expect(mockChannel.ack).toHaveBeenCalledTimes(3);
    });
  });

  // ===== OBSERVABILITY TESTS =====
  describe('Observability', () => {
    beforeEach(() => {
      // Mock console methods for observability tests
      global.console = mockConsole as any;
    });

    it('should log appropriate metrics for successful processing', async () => {
      mockFirst.mockResolvedValue(mockIntegration);

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      (performInitialSync as jest.Mock).mockResolvedValue(undefined);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      // Verify logs contain relevant information
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Received sync job for integration ID: 123')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Sync job COMPLETED for 123')
      );
    });

    it('should log detailed errors for troubleshooting', async () => {
      // Mock database to throw error on initial query, but allow update in catch block to work
      let shouldThrow = true;
      (db as jest.MockedFunction<any>).mockImplementation((table: string) => {
        if (shouldThrow && table === 'integrations') {
          shouldThrow = false; // Only throw on the first call (the query)
          throw new Error('Database connection timeout');
        }
        // For subsequent calls (like the update in catch block), return a working mock
        return {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue(1)
        };
      });

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      // Verify error is logged with context
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing sync job:'),
        expect.any(Error)
      );
    });

    it('should track processing duration', async () => {
      (getQueueChannel as jest.Mock).mockReturnValue(mockChannel);

      const mockWhere = jest.fn().mockReturnThis();
      const mockFirst = jest.fn().mockResolvedValue(mockIntegration);
      (db as unknown as jest.Mock).mockImplementation(() => ({
        where: mockWhere,
        first: mockFirst
      }));

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      // Mock performInitialSync to take some time
      (performInitialSync as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 10))
      );

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      const startTime = Date.now();
      await processSyncJob(mockMsg);
      const endTime = Date.now();

      // Verify processing completes within reasonable time
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      expect(performInitialSync).toHaveBeenCalled();
    });
  });

  // ===== CONFIGURATION TESTS =====
  describe('Configuration', () => {
    it('should use correct queue name', async () => {
      let startSyncWorker: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        startSyncWorker = worker.startSyncWorker;
      });

      startSyncWorker();

      expect(mockChannel.consume).toHaveBeenCalledWith(
        'sync_jobs',
        expect.any(Function),
        { noAck: false }
      );
    });

    it('should handle different queue names based on environment', async () => {
      // This test demonstrates how queue names could be environment-specific
      const originalNodeEnv = process.env.NODE_ENV;
      
      process.env.NODE_ENV = 'test';
      (getQueueChannel as jest.Mock).mockReturnValue(mockChannel);

      let startSyncWorker: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        startSyncWorker = worker.startSyncWorker;
      });

      startSyncWorker();

      // In a real implementation, you might have:
      // const queueName = process.env.NODE_ENV === 'test' ? 'sync_jobs_test' : 'sync_jobs';
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'sync_jobs', // Currently hardcoded, but test verifies the expected value
        expect.any(Function),
        { noAck: false }
      );

      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  // ===== WORKER LIFECYCLE TESTS =====
  describe('Worker Lifecycle', () => {
    it('should start consuming from sync queue', async () => {
      let startSyncWorker: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        startSyncWorker = worker.startSyncWorker;
      });

      startSyncWorker();

      expect(mockChannel.consume).toHaveBeenCalledWith(
        'sync_jobs',
        expect.any(Function),
        { noAck: false }
      );
    });

    it('should log worker startup', async () => {
      // Mock console for lifecycle tests
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      let startSyncWorker: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        startSyncWorker = worker.startSyncWorker;
      });

      startSyncWorker();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting Sync worker...')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sync worker started. Waiting for jobs...')
      );

      consoleLogSpy.mockRestore();
    });
  });

  // ===== DATA INTEGRITY TESTS =====
  describe('Data Integrity', () => {
    it('should validate integration data structure', async () => {
      const incompleteIntegration = {
        id: 123,
        // Missing required fields: shop_id, platform, platform_shop_name, access_token_encrypted
      };

      // Use the shared mocks
      mockFirst.mockResolvedValue(incompleteIntegration);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      // Should handle incomplete data gracefully (nack in current implementation)
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
      
      // Also verify the integration status was updated
      expect(mockUpdate).toHaveBeenCalledWith({
        sync_status: 'FAILED',
        sync_last_error: expect.stringContaining('Integration missing required fields')
      });
    });

    it('should maintain data consistency across processing steps', async () => {
      (getQueueChannel as jest.Mock).mockReturnValue(mockChannel);

      const mockWhere = jest.fn().mockReturnThis();
      const mockFirst = jest.fn().mockResolvedValue(mockIntegration);
      (db as unknown as jest.Mock).mockImplementation(() => ({
        where: mockWhere,
        first: mockFirst
      }));

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      // Track that the same integration data is used throughout
      let syncCallArgs: any[] = [];
      (performInitialSync as jest.Mock).mockImplementation((...args) => {
        syncCallArgs = args;
        return Promise.resolve();
      });

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      const mockMsg = { content: Buffer.from(JSON.stringify({ integrationId: 123 })) };

      await processSyncJob(mockMsg);

      // Verify consistent data flow
      expect(syncCallArgs[0]).toBe('decrypted-access-token');
      expect(syncCallArgs[1]).toBe('test-shop.myshopify.com');
      expect(syncCallArgs[2]).toBe(456);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle concurrent sync jobs for different shops', async () => {
      const integration1 = { ...mockIntegration, id: 1, shop_id: 100 };
      const integration2 = { ...mockIntegration, id: 2, shop_id: 200 };

      let dbCallCount = 0;
      (db as jest.MockedFunction<any>).mockImplementation((_table: string) => {
        const currentIntegration = dbCallCount++ % 2 === 0 ? integration1 : integration2;
        return {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(currentIntegration),
          update: mockUpdate
        };
      });

      (CryptoJS.AES.decrypt as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue('decrypted-access-token')
      });

      (performInitialSync as jest.Mock).mockResolvedValue(undefined);

      let processSyncJob: any;
      await jest.isolateModules(async () => {
        const worker = require('api-src/sync.worker');
        processSyncJob = worker.processSyncJob;
      });

      // Process messages concurrently
      const messages = [
        { content: Buffer.from(JSON.stringify({ integrationId: 1 })) },
        { content: Buffer.from(JSON.stringify({ integrationId: 2 })) },
      ];

      const promises = messages.map(msg => processSyncJob(msg));
      await Promise.all(promises);

      expect(performInitialSync).toHaveBeenCalledTimes(2);
      expect(mockChannel.ack).toHaveBeenCalledTimes(2);
    });
  });
});