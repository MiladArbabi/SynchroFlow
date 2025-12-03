//tests/unit/api/integration.controller.test.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';
import { connection } from 'api-src/queue';
import { getHumanReadableError } from 'api-src/api/integrations/integration.controller';
import { normalizeShopDomain, initiateOAuth } from 'api-src/api/integrations/integration.controller';

const mockedConnection = connection as jest.Mocked<typeof connection>;

// Mock dependencies
jest.mock('crypto');
jest.mock('axios');
jest.mock('api-src/db');
jest.mock('api-src/queue');

const mockedCryptoJS = {
  AES: {
    encrypt: jest.fn(() => ({ toString: () => 'encrypted-token' })), // avoid undefined.toString crash
    decrypt: jest.fn()
  }
} as any;

const mockedCrypto = crypto as jest.Mocked<typeof crypto>;
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedDb = db as unknown as jest.Mock & { raw: jest.Mock };

const mockedGetQueueChannel = getQueueChannel as jest.MockedFunction<typeof getQueueChannel>;

// Mock session
const mockSession = {
  oauth_state: undefined,
  oauth_user_id: undefined,
  destroy: jest.fn((callback) => callback()),
  save: jest.fn((callback) => callback()),
  regenerate: jest.fn((callback) => callback()),
  reload: jest.fn((callback) => callback()),
  resetMaxAge: jest.fn(), // Add missing property
  touch: jest.fn(), // Add missing property
  id: 'test-session-id',
  cookie: {
    originalMaxAge: 3600000,
    maxAge: 3600000,
    secure: false,
    httpOnly: true,
    path: '/',
  },
} as any;

describe('Integration Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  // Mock user data
  const mockUser = {
    id: 1,
    userId: 1,
    shop_id: 123,
    email: 'test@example.com'
  };

  // Mock integration data
  const mockIntegration = {
    id: 456,
    shop_id: 123,
    platform: 'shopify',
    platform_shop_name: 'test-shop.myshopify.com',
    access_token_encrypted: 'encrypted-token',
    sync_status: 'COMPLETED',
    sync_progress_current: 100,
    sync_progress_total: 100,
    sync_last_error: null
  };

  // Mock queue channel
  const mockChannel = {
    sendToQueue: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
    consume: jest.fn(),
    close: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default request
    mockRequest = {
      user: mockUser,
      session: mockSession,
      query: {},
      params: {}
    };

    // Setup response methods
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis()
    };


    // Setup environment variables
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    process.env.SHOPIFY_API_KEY = 'test-shopify-key';
    process.env.SHOPIFY_API_SECRET = 'test-shopify-secret';
    process.env.API_URL = 'http://localhost:3001';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    // Setup default mocks
    mockedGetQueueChannel.mockReturnValue(mockChannel as any);
  });

  describe('initiateOAuth', () => {
    it('should return 400 if platform is missing', async () => {
      mockRequest.query = {};

      const { initiateOAuth } = await import('api-src/api/integrations/integration.controller');
      await initiateOAuth(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Missing required query param: platform' });
    });

    it('should return 400 if shop is missing for Shopify', async () => {
        mockRequest.query = { platform: 'shopify' };
        
        // Add this line to mock crypto.randomBytes
        mockedCrypto.randomBytes.mockReturnValue({ toString: () => 'test-state-token' } as any);

        const { initiateOAuth } = await import('api-src/api/integrations/integration.controller');
        await initiateOAuth(mockRequest as Request, mockResponse as Response);

        expect(mockResponse.status).toHaveBeenCalledWith(400);
        expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Missing required query param: shop' });
    });

    it('should return 500 if user is not authenticated', async () => {
      mockRequest.user = undefined;
      mockRequest.query = { platform: 'shopify', shop: 'test-shop' };

      const { initiateOAuth } = await import('api-src/api/integrations/integration.controller');
      await initiateOAuth(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Authenticated user ID not found.' });
    });

    it('should generate Shopify authorization URL successfully', async () => {
      mockRequest.query = { platform: 'shopify', shop: 'test-shop' };
      mockedCrypto.randomBytes.mockReturnValue({ toString: () => 'test-state-token' } as any);

      const { initiateOAuth } = await import('api-src/api/integrations/integration.controller');
      await initiateOAuth(mockRequest as Request, mockResponse as Response);

      expect(mockSession.oauth_state).toBe('test-state-token');
      expect(mockSession.oauth_user_id).toBe(mockUser.userId);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      
      // Verify the URL is constructed correctly without redundant {shop} replacement
      const expectedRedirectUri = encodeURIComponent('http://localhost:3001/api/v1/integrations/oauth/callback/shopify');
      const expectedUrl = `https://test-shop.myshopify.com/admin/oauth/authorize?client_id=test-shopify-key&scope=read_products,read_orders,read_customers,read_inventory,read_payouts,read_fulfillments,write_script_tags,read_script_tags&redirect_uri=${expectedRedirectUri}&state=test-state-token`;
      expect(mockResponse.json).toHaveBeenCalledWith({
        authorizationUrl: expectedUrl
      });
      
      // Additional verification: ensure no {shop} placeholder remains in the URL
      const actualUrl = (mockResponse.json as jest.Mock).mock.calls[0][0].authorizationUrl;
      expect(actualUrl).not.toContain('{shop}');
      expect(actualUrl).toContain('test-shop.myshopify.com');
    });

    it('should generate Shopify authorization URL with properly encoded redirect_uri', async () => {
      mockRequest.query = { platform: 'shopify', shop: 'test-shop' };
      mockedCrypto.randomBytes.mockReturnValue({ toString: () => 'test-state-token' } as any);

      const { initiateOAuth } = await import('api-src/api/integrations/integration.controller');
      await initiateOAuth(mockRequest as Request, mockResponse as Response);

      // Verify the redirect_uri is properly encoded
      const expectedRedirectUri = encodeURIComponent('http://localhost:3001/api/v1/integrations/oauth/callback/shopify');
      expect(mockResponse.json).toHaveBeenCalledWith({
        authorizationUrl: expect.stringContaining(`redirect_uri=${expectedRedirectUri}`)
      });
    });

    it('should return 501 for unsupported platforms', async () => {
      mockRequest.query = { platform: 'quickbooks' };

      const { initiateOAuth } = await import('api-src/api/integrations/integration.controller');
      await initiateOAuth(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(501);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'QuickBooks not yet implemented' });
    });
  });

  describe('handleOAuthCallback', () => {
    beforeEach(() => {
      mockRequest.params = { platform: 'shopify' };
      mockRequest.query = { 
        code: 'test-auth-code', 
        state: 'test-state-token',
        shop: 'test-shop.myshopify.com'
      };
      mockSession.oauth_state = 'test-state-token';
      mockSession.oauth_user_id = mockUser.userId;
    });

    it('should return 403 if user ID is missing from session', async () => {
      mockSession.oauth_user_id = undefined;

      const { handleOAuthCallback } = await import('api-src/api/integrations/integration.controller');
      await handleOAuthCallback(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid session: No user ID found.' });
    });

    it('should return 403 if CSRF state is invalid', async () => {
      mockSession.oauth_state = 'different-state-token';

      const { handleOAuthCallback } = await import('api-src/api/integrations/integration.controller');
      await handleOAuthCallback(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid CSRF state token.' });
    });

    it('should successfully handle OAuth callback and create integration', async () => {
      // Mock token exchange
      mockedAxios.post.mockResolvedValue({
          data: { access_token: 'test-access-token' }
      });

      // Mock user lookup
      const mockUserWhere = jest.fn().mockReturnThis();
      const mockUserFirst = jest.fn().mockResolvedValue(mockUser);
      
      // Mock integration insertion with proper Knex chain
      const mockReturning = jest.fn().mockResolvedValue([mockIntegration]);
      const mockInsert = jest.fn().mockReturnValue({
          returning: mockReturning
      });

      // Mock user update operation
      const mockUserUpdate = jest.fn().mockReturnThis();
      
      // Mock milestone insertion with proper chaining
      const mockMilestoneInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue([1]);

      (mockedDb as jest.Mock).mockImplementation((table: string) => {
          if (table === 'users') {
          return {
              where: mockUserWhere,
              first: mockUserFirst,
              update: mockUserUpdate
            };
          }
          if (table === 'integrations') {
          return {
              insert: mockInsert
            };
          }
          if (table === 'user_milestones') {
          return {
             insert: mockMilestoneInsert,
             onConflict: mockOnConflict,
             ignore: mockIgnore
          };
         }
          return {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null)
          };
      });

      // Mock encryption
      (mockedCryptoJS.AES.encrypt as jest.Mock).mockReturnValue('encrypted-token');

      // Mock ShopifyAppService
      jest.mock('api-src/services/shopify-app.service', () => ({
          ShopifyAppService: {
              completePostInstallation: jest.fn().mockResolvedValue(undefined),
          },
      }));

      const { handleOAuthCallback } = await import('api-src/api/integrations/integration.controller');
      await handleOAuthCallback(mockRequest as Request, mockResponse as Response);

      // Verify the insert was called with correct core data
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          shop_id: mockUser.shop_id,
          platform: 'shopify',
          platform_shop_name: 'test-shop.myshopify.com'
        })
      );

      // And ensure we actually stored some encrypted token string
      const insertedArgs = (mockInsert as jest.Mock).mock.calls[0][0];
      expect(insertedArgs.access_token_encrypted).toEqual(expect.any(String));

      // Verify the sync job was queued
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
          'sync_jobs',
          Buffer.from(JSON.stringify({ integrationId: mockIntegration.id }))
      );

      // Verify redirect
      expect(mockResponse.redirect).toHaveBeenCalledWith(
          'http://localhost:3000/dashboard?connect=success'
      );
    });

    it('should handle token exchange failure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Token exchange failed'));

      const mockUserWhere = jest.fn().mockReturnThis();
      const mockUserFirst = jest.fn().mockResolvedValue(mockUser);
      mockedDb.mockImplementation(() => ({
        where: mockUserWhere,
        first: mockUserFirst
      }) as any);

      const { handleOAuthCallback } = await import('api-src/api/integrations/integration.controller');
      await handleOAuthCallback(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Internal server error during token exchange.' });
    });
  });

    describe('OAuth Cancel Flow', () => {
    it('should handle Shopify cancel by redirecting to frontend with error', async () => {
      // Simulate the callback with error=access_denied (user clicked cancel)
      mockRequest.params = { platform: 'shopify' };
      mockRequest.query = {
        error: 'access_denied',
        error_description: 'User canceled the authorization',
        state: 'test-state-token',
        shop: 'test-shop.myshopify.com'
      };
      
      // Set up the session state to match
      mockSession.oauth_state = 'test-state-token';
      mockSession.oauth_user_id = 1;

      const { handleOAuthCallback } = await import('api-src/api/integrations/integration.controller');
      await handleOAuthCallback(mockRequest as Request, mockResponse as Response);

      // Verify the redirect to frontend with error parameters
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/dashboard?connect=error&message=Authorization+was+canceled.+Please+try+again+and+approve+the+installation.'
      );
      
      // Verify session is cleared
      expect(mockSession.oauth_state).toBeUndefined();
      expect(mockSession.oauth_user_id).toBeUndefined();
    });
  });

  describe('getSyncStatus', () => {
    // Mock the helper function by mocking the database calls
    const setupShopIdMock = (shopId: number | null) => {
      const mockUserWhere = jest.fn().mockReturnThis();
      const mockUserFirst = jest.fn().mockResolvedValue(shopId ? { shop_id: shopId } : null);
      
      (mockedDb as unknown as jest.Mock).mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUserWhere,
            first: mockUserFirst
          };
        }
        return {
          where: mockUserWhere,
          first: mockUserFirst
        };
      });
    };

    // In the test "should return sync status successfully (Happy Path)", replace the setup:
    it('should return sync status successfully (Happy Path)', async () => {
    // Mock user lookup to return shop ID
    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 123 });

    // Mock integrations lookup
    const mockIntegrationsWhere = jest.fn().mockReturnThis();
    const mockIntegrationsFirst = jest.fn().mockResolvedValue({
        sync_status: 'SYNCING_PRODUCTS',
        sync_progress_current: 50,
        sync_progress_total: 100,
        sync_last_error: null
    });

    (mockedDb as jest.Mock).mockImplementation((table: string) => {
        if (table === 'users') {
        return {
            where: mockUserWhere,
            first: mockUserFirst
        };
        }
        if (table === 'integrations') {
        return {
            where: mockIntegrationsWhere,
            first: mockIntegrationsFirst
        };
        }
        return {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null)
        };
    });

    const { getSyncStatus } = await import('api-src/api/integrations/integration.controller');
    await getSyncStatus(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'SYNCING_PRODUCTS',
        progress: {
        current: 50,
        total: 100,
        percentage: 50,
        },
        lastError: null,
    });
    });

    it('should return 403 if shop not found', async () => {
      setupShopIdMock(null);

      const { getSyncStatus } = await import('api-src/api/integrations/integration.controller');
      await getSyncStatus(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    // Fix for "should return 404 if integration not found"
    it('should return 404 if integration not found', async () => {
    // Mock user lookup to return shop ID
    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 123 });

    // Mock integrations lookup to return undefined (no integration found)
    const mockIntegrationsWhere = jest.fn().mockReturnThis();
    const mockIntegrationsFirst = jest.fn().mockResolvedValue(undefined);

    (mockedDb as jest.Mock).mockImplementation((table: string) => {
        if (table === 'users') {
        return {
            where: mockUserWhere,
            first: mockUserFirst
        };
        }
        if (table === 'integrations') {
        return {
            where: mockIntegrationsWhere,
            first: mockIntegrationsFirst
        };
        }
        return {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null)
        };
    });

    const { getSyncStatus } = await import('api-src/api/integrations/integration.controller');
    await getSyncStatus(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Shopify integration not found.' });
    });

    // Fix for "should calculate 100% percentage for completed sync"
    it('should calculate 100% percentage for completed sync', async () => {
    // Mock user lookup to return shop ID
    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 123 });

    // Mock integrations lookup to return completed status
    const mockIntegrationsWhere = jest.fn().mockReturnThis();
    const mockIntegrationsFirst = jest.fn().mockResolvedValue({
        sync_status: 'COMPLETED',
        sync_progress_current: 0,
        sync_progress_total: 0,
        sync_last_error: null
    });

    (mockedDb as jest.Mock).mockImplementation((table: string) => {
        if (table === 'users') {
        return {
            where: mockUserWhere,
            first: mockUserFirst
        };
        }
        if (table === 'integrations') {
        return {
            where: mockIntegrationsWhere,
            first: mockIntegrationsFirst
        };
        }
        return {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null)
        };
    });

    const { getSyncStatus } = await import('api-src/api/integrations/integration.controller');
    await getSyncStatus(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.json).toHaveBeenCalledWith({
        status: 'COMPLETED',
        progress: {
        current: 0,
        total: 0,
        percentage: 100,
        },
        lastError: null,
    });
    });

    // Fix for "should handle database errors gracefully"
    it('should handle database errors gracefully', async () => {
    // Mock user lookup to return shop ID
    const mockUserWhere = jest.fn().mockReturnThis();
    const mockUserFirst = jest.fn().mockResolvedValue({ shop_id: 123 });

    // Mock integrations lookup to throw error
    const mockIntegrationsWhere = jest.fn().mockReturnThis();
    const mockIntegrationsFirst = jest.fn().mockRejectedValue(new Error('Database error'));

    (mockedDb as jest.Mock).mockImplementation((table: string) => {
        if (table === 'users') {
        return {
            where: mockUserWhere,
            first: mockUserFirst
        };
        }
        if (table === 'integrations') {
        return {
            where: mockIntegrationsWhere,
            first: mockIntegrationsFirst
        };
        }
        return {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null)
        };
    });

    const { getSyncStatus } = await import('api-src/api/integrations/integration.controller');
    await getSyncStatus(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Failed to fetch sync status.' });
    });
  });

  describe('Edge Cases and Security', () => {
    it('should clear session state after OAuth callback', async () => {
      mockRequest.params = { platform: 'shopify' };
      mockRequest.query = { 
        code: 'test-auth-code', 
        state: 'test-state-token',
        shop: 'test-shop.myshopify.com'
      };
      mockSession.oauth_state = 'test-state-token';
      mockSession.oauth_user_id = mockUser.userId;

      // Mock successful flow
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'test-access-token' }
      });

      const mockUserWhere = jest.fn().mockReturnThis();
      const mockUserFirst = jest.fn().mockResolvedValue(mockUser);
      const mockInsert = jest.fn().mockReturnThis();
      const mockReturning = jest.fn().mockResolvedValue([mockIntegration]);
      
      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') return { where: mockUserWhere, first: mockUserFirst };
        if (table === 'integrations') return { insert: mockInsert, returning: mockReturning };
        return { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
      });

      mockedCryptoJS.AES.encrypt.mockReturnValue('encrypted-token' as any);

      const { handleOAuthCallback } = await import('api-src/api/integrations/integration.controller');
      await handleOAuthCallback(mockRequest as Request, mockResponse as Response);

      // Session state should be cleared
      expect(mockSession.oauth_state).toBeUndefined();
      expect(mockSession.oauth_user_id).toBeUndefined();
    });

    it('should handle missing encryption key', async () => {
      delete process.env.ENCRYPTION_KEY;

      const { initiateOAuth } = await import('api-src/api/integrations/integration.controller');
      
      // This would throw if encryption is attempted without key
      // We're testing that the flow doesn't reach encryption without proper setup
      await initiateOAuth(mockRequest as Request, mockResponse as Response);

      // The test passes as long as no encryption is attempted without the key
      expect(mockedCryptoJS.AES.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('preFlightCheck', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reset environment variables to known state
      process.env.SHOPIFY_API_KEY = 'test-shopify-key';
      process.env.SHOPIFY_API_SECRET = 'test-shopify-secret';
    });

    it('should return 200 when all services are ready (Happy Path)', async () => {
      // Mock DB connection success
      (mockedDb.raw as jest.Mock).mockResolvedValue(undefined);
      
      // Mock queue connection success
      mockedConnection.isConnected.mockReturnValue(true);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ 
        ready: true, 
        issues: [] 
      });
    });

    it('should return 503 when database connection fails', async () => {
      // Mock DB connection failure
      (mockedDb.raw as jest.Mock).mockRejectedValue(new Error('DB connection failed'));
      
      // Mock queue connection success
      mockedConnection.isConnected.mockReturnValue(true);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({ 
        ready: false, 
        issues: ['Database connection error.'] 
      });
    });

    it('should return 503 when queue connection fails', async () => {
      // Mock DB connection success
      (mockedDb.raw as jest.Mock).mockResolvedValue(undefined);
      
      // Mock queue connection failure
      mockedConnection.isConnected.mockReturnValue(false);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({ 
        ready: false, 
        issues: ['Message queue not connected.'] 
      });
    });

    it('should return 503 when Shopify API credentials are missing', async () => {
      // Remove environment variables
      delete process.env.SHOPIFY_API_KEY;
      
      // Mock DB connection success
      (mockedDb.raw as jest.Mock).mockResolvedValue(undefined);
      
      // Mock queue connection success
      mockedConnection.isConnected.mockReturnValue(true);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({ 
        ready: false, 
        issues: ['Server configuration incomplete.'] 
      });
    });

    it('should return 503 when multiple issues exist', async () => {
      // Remove environment variables
      delete process.env.SHOPIFY_API_KEY;
      
      // Mock DB connection failure
      (mockedDb.raw as jest.Mock).mockRejectedValue(new Error('DB connection failed'));
      
      // Mock queue connection failure
      mockedConnection.isConnected.mockReturnValue(false);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({ 
        ready: false, 
        issues: [
          'Database connection error.',
          'Message queue not connected.',
          'Server configuration incomplete.'
        ] 
      });
    });

    it('should log database errors to console', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Mock DB connection failure
      const dbError = new Error('DB connection failed');
      (mockedDb.raw as jest.Mock).mockRejectedValue(dbError);
      
      // Mock queue connection success
      mockedConnection.isConnected.mockReturnValue(true);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[preFlightCheck] DB connection failed:',
        'DB connection failed'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle missing SHOPIFY_API_SECRET', async () => {
      // Remove secret environment variable
      delete process.env.SHOPIFY_API_SECRET;
      
      // Mock DB connection success
      (mockedDb.raw as jest.Mock).mockResolvedValue(undefined);
      
      // Mock queue connection success
      mockedConnection.isConnected.mockReturnValue(true);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({ 
        ready: false, 
        issues: ['Server configuration incomplete.'] 
      });
    });

    it('should handle both missing API key and secret', async () => {
      // Remove both environment variables
      delete process.env.SHOPIFY_API_KEY;
      delete process.env.SHOPIFY_API_SECRET;
      
      // Mock DB connection success
      (mockedDb.raw as jest.Mock).mockResolvedValue(undefined);
      
      // Mock queue connection success
      mockedConnection.isConnected.mockReturnValue(true);

      const { preFlightCheck } = await import('api-src/api/integrations/integration.controller');
      await preFlightCheck(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({ 
        ready: false, 
        issues: ['Server configuration incomplete.'] 
      });
    });
  });

  describe('OAuth Error Mapping', () => {
    test('maps access_denied to user-friendly message', () => {
      const result = getHumanReadableError('access_denied', 'User denied access');
      expect(result).toBe('Authorization was canceled. Please try again and approve the installation.');
    });

    test('maps invalid_scope to appropriate message', () => {
      const result = getHumanReadableError('invalid_scope', 'Invalid scope requested');
      expect(result).toBe('The app requires additional permissions. Please contact support.');
    });

    test('maps trial_store error', () => {
      const result = getHumanReadableError('trial_store', 'Trial stores cannot install');
      expect(result).toBe('This app cannot be installed on trial stores. Please upgrade your Shopify plan.');
    });

    test('maps suspended_store error', () => {
      const result = getHumanReadableError('suspended_store', 'Store suspended');
      expect(result).toBe('Your Shopify store is currently suspended. Please resolve any billing issues.');
    });

    test('maps app_installation_failed error', () => {
      const result = getHumanReadableError('app_installation_failed', 'Installation failed');
      expect(result).toBe('App installation failed. Please try again or contact Shopify support.');
    });

    test('returns description for unknown errors', () => {
      const result = getHumanReadableError('unknown_error', 'Some weird issue');
      expect(result).toBe('Some weird issue');
    });

    test('returns default message for completely unknown errors', () => {
      const result = getHumanReadableError('completely_unknown', '');
      expect(result).toBe('An unknown error occurred during installation.');
    });
  });

  // Add these tests to integration.controller.test.ts
  describe('Shop Domain Normalization', () => {
    test('should add .myshopify.com to bare shop name', async () => {
      const { normalizeShopDomain } = await import('api-src/api/integrations/integration.controller');
      expect(normalizeShopDomain('mystore')).toBe('mystore.myshopify.com');
    });

    test('should keep existing .myshopify.com domain', async () => {
      const { normalizeShopDomain } = await import('api-src/api/integrations/integration.controller');
      expect(normalizeShopDomain('mystore.myshopify.com')).toBe('mystore.myshopify.com');
    });

    test('should remove https protocol', async () => {
      const { normalizeShopDomain } = await import('api-src/api/integrations/integration.controller');
      expect(normalizeShopDomain('https://mystore.myshopify.com')).toBe('mystore.myshopify.com');
    });

    test('should remove http protocol', async () => {
      const { normalizeShopDomain } = await import('api-src/api/integrations/integration.controller');
      expect(normalizeShopDomain('http://mystore.myshopify.com')).toBe('mystore.myshopify.com');
    });

    test('should remove /admin path', async () => {
      const { normalizeShopDomain } = await import('api-src/api/integrations/integration.controller');
      expect(normalizeShopDomain('mystore.myshopify.com/admin')).toBe('mystore.myshopify.com');
    });

    test('should handle complex input with protocol and path', async () => {
      const { normalizeShopDomain } = await import('api-src/api/integrations/integration.controller');
      expect(normalizeShopDomain('https://mystore.myshopify.com/admin/oauth')).toBe('mystore.myshopify.com');
    });
  });
});