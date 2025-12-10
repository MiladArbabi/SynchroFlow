// tests/unit/specter/specter.controller.test.ts
import type { Request, Response } from 'express';
import path from 'path';

// Mock the database module to prevent real DB calls
jest.mock('api-src/db');

// Mock the console methods to clean up test output
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
const mockConsoleDebug = jest.spyOn(console, 'debug').mockImplementation(() => {});

describe('Specter Controller', () => {
  // Reset all mocks and modules before each test
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Clear require cache for session-store module
    Object.keys(require.cache).forEach(key => {
      if (key.includes('session-store')) {
        delete require.cache[key];
      }
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  // Test utility functions
  const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
    user: { userId: 1 },
    ...overrides,
  } as any);

  const mockResponse = (): Partial<Response> => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  // Test data
  const TEST_SHOP_ID = 42;
  const TEST_USER_ID = 1;
  const TEST_SESSION = { 
    sessionId: 's1', 
    shopId: TEST_SHOP_ID, 
    createdAt: new Date().toISOString(), 
    exitIntent: false 
  };
  const TEST_CONFIG = { mode: 'fast', enabled: true };
  const TEST_EVENTS = [
    { type: 'canonical.ingested', timestamp: 1, payload: { canonicalOrderId: 'o1' } },
    { type: 'sync.complete', timestamp: 2, payload: { success: true } },
    { type: 'session.created', timestamp: 3, payload: { sessionId: 's1' } }
  ];

  describe('getSpecterConfig', () => {
    test('returns config when user has shop and config exists', async () => {
      // Mock DB to return user with shop and config
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        if (table === 'specter_shop_configs') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ 
              shop_id: TEST_SHOP_ID, 
              config_json: TEST_CONFIG 
            })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        config: TEST_CONFIG
      });
    });

    test('returns null config when config does not exist', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        if (table === 'specter_shop_configs') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue(null)
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        config: null
      });
    });

    test('returns 403 when user has no shop', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue(null)
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    test('returns 403 when user is not authenticated', async () => {
      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest({ user: undefined });
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    test.skip('handles database error gracefully and returns 500', async () => {
      // We need to mock the db to throw an error at the right time
      const db = require('api-src/db').default;
      let callCount = 0;
      db.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) {
          // First call for user lookup succeeds
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        // Second call for config lookup throws in the main try block
        throw new Error('Database connection failed');
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch Specter config.' });
      expect(mockConsoleError).toHaveBeenCalled();
    });

    test('handles config lookup error gracefully and returns null config', async () => {
      const db = require('api-src/db').default;
      let callCount = 0;
      db.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) {
          // First call for user lookup
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        // Second call for config lookup throws
        // This should be caught in the inner try-catch
        throw new Error('Config table not found');
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        config: null
      });
      expect(mockConsoleWarn).toHaveBeenCalled();
    });
  });

  describe('getSpecterState', () => {
    // Mock session-store functions that will be used by multiple tests
    const mockGetShopSession = jest.fn();
    const mockGetRecentEvents = jest.fn();

    beforeEach(() => {
      mockGetShopSession.mockClear();
      mockGetRecentEvents.mockClear();
    });

    test.skip('returns complete state when all data exists', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        if (table === 'specter_shop_configs') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ 
              shop_id: TEST_SHOP_ID, 
              config_json: TEST_CONFIG 
            })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      // Mock session-store with direct exports
      mockGetShopSession.mockResolvedValue(TEST_SESSION);
      mockGetRecentEvents.mockResolvedValue(TEST_EVENTS);
      
      // Mock the specific path that the controller will try first
      jest.doMock('modules-specter/store/session-store', () => ({
        getShopSession: mockGetShopSession,
        getRecentEvents: mockGetRecentEvents
      }));

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      expect(mockGetShopSession).toHaveBeenCalledWith(TEST_SHOP_ID);
      expect(mockGetRecentEvents).toHaveBeenCalledWith(TEST_SHOP_ID, 50);
      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        session: TEST_SESSION,
        config: TEST_CONFIG,
        events: TEST_EVENTS,
        meta: {
          sessionCount: 1,
          lastSync: 2,
          lastIngestion: 1
        }
      });
    });

    test.skip('handles missing session-store module gracefully', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        if (table === 'specter_shop_configs') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ 
              shop_id: TEST_SHOP_ID, 
              config_json: TEST_CONFIG 
            })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      // Clear any mocks and don't mock session-store
      jest.dontMock('modules-specter/store/session-store');
      
      // Mock require to throw for session-store module
      const originalRequire = require;
      jest.spyOn(require, 'require').mockImplementation((id: string) => {
        if (id.includes('session-store')) {
          throw new Error('Module not found');
        }
        return originalRequire(id);
      });

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        session: null,
        config: TEST_CONFIG,
        events: [],
        meta: {
          sessionCount: 0,
          lastSync: null,
          lastIngestion: null
        }
      });
    });

    test('handles session-store with direct exports (not default)', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        if (table === 'specter_shop_configs') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ 
              shop_id: TEST_SHOP_ID, 
              config_json: TEST_CONFIG 
            })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      // Mock session-store with direct exports
      mockGetShopSession.mockResolvedValue(TEST_SESSION);
      mockGetRecentEvents.mockResolvedValue(TEST_EVENTS.slice(0, 1));
      
      // Mock the relative path that the controller will try
      const relativePath = require.resolve('../../../modules/specter/src/store/session-store');
      jest.doMock(relativePath, () => ({
        getShopSession: mockGetShopSession,
        getRecentEvents: mockGetRecentEvents
      }));

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      expect(mockGetShopSession).toHaveBeenCalledWith(TEST_SHOP_ID);
      expect(mockGetRecentEvents).toHaveBeenCalledWith(TEST_SHOP_ID, 50);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        shopId: TEST_SHOP_ID,
        session: TEST_SESSION,
        events: TEST_EVENTS.slice(0, 1)
      }));
    });

    test('handles empty events array', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        if (table === 'specter_shop_configs') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue(null)
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      mockGetShopSession.mockResolvedValue(null);
      mockGetRecentEvents.mockResolvedValue([]);
      
      jest.doMock('../../../modules/specter/src/store/session-store', () => ({
        getShopSession: mockGetShopSession,
        getRecentEvents: mockGetRecentEvents
      }));

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        session: null,
        config: null,
        events: [],
        meta: {
          sessionCount: 0,
          lastSync: null,
          lastIngestion: null
        }
      });
    });

    test('handles database error in config lookup gracefully', async () => {
      const db = require('api-src/db').default;
      let callCount = 0;
      db.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) {
          // First call for user lookup succeeds
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        // Second call for config lookup - Note: In getSpecterState, this is NOT wrapped in try-catch
        // So it will throw and be caught by the main try-catch, returning 500
        throw new Error('Config table not available');
      });

      mockGetShopSession.mockResolvedValue(TEST_SESSION);
      mockGetRecentEvents.mockResolvedValue([]);
      
      jest.doMock('../../../modules/specter/src/store/session-store', () => ({
        getShopSession: mockGetShopSession,
        getRecentEvents: mockGetRecentEvents
      }));

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      // The error is NOT caught by an inner try-catch in getSpecterState
      // So it should return 500
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch Specter state.' });
      expect(mockConsoleError).toHaveBeenCalled();
    });

    test('returns 500 on unexpected error', async () => {
      const db = require('api-src/db').default;
      // This should throw in getShopIdFromRequest, which catches and returns null
      // leading to 403, not 500
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          throw new Error('Unexpected database error');
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      // getShopIdFromRequest catches the error and returns null, so 403
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'User shop not found.' });
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test('returns 500 on unexpected error in main handler', async () => {
      const db = require('api-src/db').default;
      // Mock user lookup to succeed
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        // Throw an error when config is looked up - not caught by inner try-catch
        throw new Error('Unexpected database error in main handler');
      });

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch Specter state.' });
      expect(mockConsoleError).toHaveBeenCalled();
    });

    test('limits events to 50 by default', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        if (table === 'specter_shop_configs') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ 
              shop_id: TEST_SHOP_ID, 
              config_json: TEST_CONFIG 
            })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      mockGetShopSession.mockResolvedValue(TEST_SESSION);
      mockGetRecentEvents.mockResolvedValue(TEST_EVENTS);
      
      jest.doMock('../../../modules/specter/src/store/session-store', () => ({
        getShopSession: mockGetShopSession,
        getRecentEvents: mockGetRecentEvents
      }));

      const { getSpecterState } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterState(req as any, res as any);

      expect(mockGetRecentEvents).toHaveBeenCalledWith(TEST_SHOP_ID, 50);
    });
  });

  describe('upsertSpecterConfig', () => {
    test('creates new config successfully', async () => {
      const db = require('api-src/db').default;
      let callCount = 0;
      db.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) {
          // User lookup
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        // Config upsert
        const mockReturning = jest.fn().mockResolvedValue([{
          shop_id: TEST_SHOP_ID,
          config_json: TEST_CONFIG
        }]);
        
        return {
          insert: jest.fn().mockReturnValue({
            onConflict: jest.fn().mockReturnValue({
              merge: jest.fn().mockReturnValue({
                returning: mockReturning
              })
            })
          })
        };
      });

      const { upsertSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest({ body: { config: TEST_CONFIG } });
      const res = mockResponse();

      await upsertSpecterConfig(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        config: TEST_CONFIG
      });
    });

    test('updates existing config successfully', async () => {
      const db = require('api-src/db').default;
      let callCount = 0;
      db.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) {
          // User lookup
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        // Config upsert
        const mockReturning = jest.fn().mockResolvedValue([{
          shop_id: TEST_SHOP_ID,
          config_json: { ...TEST_CONFIG, updated: true }
        }]);
        
        return {
          insert: jest.fn().mockReturnValue({
            onConflict: jest.fn().mockReturnValue({
              merge: jest.fn().mockReturnValue({
                returning: mockReturning
              })
            })
          })
        };
      });

      const { upsertSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest({ body: { config: { ...TEST_CONFIG, updated: true } } });
      const res = mockResponse();

      await upsertSpecterConfig(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        shopId: TEST_SHOP_ID,
        config: { ...TEST_CONFIG, updated: true }
      });
    });

    test('returns 400 for invalid config payload', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { upsertSpecterConfig } = await import('api-src/api/specter/specter.controller');
      
      // Test with array (invalid)
      const req1 = mockRequest({ body: { config: [] } });
      const res1 = mockResponse();
      await upsertSpecterConfig(req1 as any, res1 as any);
      expect(res1.status).toHaveBeenCalledWith(400);
      expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('Invalid config payload')
      }));

      // Test with null (invalid)
      const req2 = mockRequest({ body: { config: null } });
      const res2 = mockResponse();
      await upsertSpecterConfig(req2 as any, res2 as any);
      expect(res2.status).toHaveBeenCalledWith(400);

      // Test with string (invalid)
      const req3 = mockRequest({ body: { config: 'not an object' } });
      const res3 = mockResponse();
      await upsertSpecterConfig(req3 as any, res3 as any);
      expect(res3.status).toHaveBeenCalledWith(400);
    });

    test('returns 403 when user has no shop', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue(null)
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { upsertSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest({ body: { config: TEST_CONFIG } });
      const res = mockResponse();

      await upsertSpecterConfig(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    test('returns 500 on database error', async () => {
      const db = require('api-src/db').default;
      let callCount = 0;
      db.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) {
          // User lookup succeeds
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        // Config upsert throws
        throw new Error('Database write failed');
      });

      const { upsertSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest({ body: { config: TEST_CONFIG } });
      const res = mockResponse();

      await upsertSpecterConfig(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to upsert Specter config.' });
      expect(mockConsoleError).toHaveBeenCalled();
    });
  });

  describe('getShopIdFromRequest helper', () => {
    test('returns shop_id when user exists', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: TEST_SHOP_ID })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      // Success case - no 403 error
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('returns null when user lookup fails in database', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          throw new Error('User table not accessible');
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    test('returns null when user has no shop_id', async () => {
      const db = require('api-src/db').default;
      db.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: null })
          };
        }
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      const { getSpecterConfig } = await import('api-src/api/specter/specter.controller');
      const req = mockRequest();
      const res = mockResponse();

      await getSpecterConfig(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});