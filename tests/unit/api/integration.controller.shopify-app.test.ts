// tests/unit/api/integration.controller.shopify-app.test.ts
import { handleOAuthCallback, initiateOAuth } from 'api-src/api/integrations/integration.controller';

// ✅ CORRECT: Using factory pattern inside jest.mock
jest.mock('api-src/db', () => {
  // 1. Define chainable methods
  const mockDbInstance = {
    // Chainable methods (return this)
    insert: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    ignore: jest.fn().mockReturnThis(),
    
    // Terminal methods (return data/void)
    first: jest.fn(),
    then: jest.fn(), // For promise chains
  };
  
  // 2. Create db function with fn property
  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { 
    now: jest.fn(() => 'mocked-now') 
  };
  
  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn
  };
});

// Mock other dependencies
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  }
}));

// ✅ FIX: Use the exact same CryptoJS mock pattern from the working test file
jest.mock('crypto-js', () => ({
  AES: {
    encrypt: jest.fn((data, _key) => ({
      toString: () => `encrypted-${data}`
    })),
  },
  enc: {
    Utf8: 'utf8'
  }
}));

jest.mock('api-src/queue', () => ({
  __esModule: true,
  getQueueChannel: jest.fn(() => {
    console.log('📨 getQueueChannel called');
    return {
      sendToQueue: jest.fn((queueName, buffer) => {
        console.log('📨 sendToQueue completed for:', queueName);
        return Promise.resolve();
      })
    };
  }),
  connection: { isConnected: jest.fn(() => true) }
}));

jest.mock('api-src/services/shopify-app.service', () => ({
  __esModule: true,
  ShopifyAppService: {
    completePostInstallation: jest.fn(),
  }
}));

// tests/unit/api/integration.controller.shopify-app.test.ts

describe('Integration Controller - Shopify App Integration', () => {
  const mockDbInstance = (require('api-src/db').default() as any);
  const axios = require('axios').default;
  const { ShopifyAppService } = require('api-src/services/shopify-app.service');

  beforeEach(() => {
    jest.clearAllMocks();
    
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    
    // Restore ALL chain methods
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.where.mockReturnValue(mockDbInstance);
    mockDbInstance.andWhere.mockReturnValue(mockDbInstance);
    mockDbInstance.update.mockReturnValue(mockDbInstance);
    mockDbInstance.onConflict.mockReturnValue(mockDbInstance);
    mockDbInstance.merge.mockReturnValue(mockDbInstance);
    mockDbInstance.returning.mockReturnValue(mockDbInstance);
    mockDbInstance.ignore.mockReturnValue(mockDbInstance);
    
    // Set up terminal methods with default values
    mockDbInstance.first.mockResolvedValue({ id: 1, shop_id: 123 });
    mockDbInstance.then.mockResolvedValue([1]);
  });

  describe('Shopify OAuth Callback', () => {
    test('should complete OAuth flow successfully', async () => {
      // ... existing test (keep it as is)
    });

    test('should handle OAuth errors gracefully', async () => {
      // Arrange
      const mockReq = {
        params: { platform: 'shopify' },
        query: { 
          error: 'access_denied',
          error_description: 'User denied access'
        },
        session: {
          oauth_state: 'valid-state',
          oauth_user_id: 1
        }
      };

      const mockRes = {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Act
      await handleOAuthCallback(mockReq as any, mockRes as any);

      // Assert
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/dashboard?connect=error')
      );
    });

    test('should reject invalid CSRF state', async () => {
      // Arrange
      const mockReq = {
        params: { platform: 'shopify' },
        query: { 
          code: 'auth-code-123', 
          state: 'invalid-state',
          shop: 'test-store.myshopify.com'
        },
        session: {
          oauth_state: 'valid-state',
          oauth_user_id: 1
        }
      };

      const mockRes = {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Act
      await handleOAuthCallback(mockReq as any, mockRes as any);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid CSRF state token.' });
    });

    test('should handle missing user ID', async () => {
      // Arrange
      const mockReq = {
        params: { platform: 'shopify' },
        query: { 
          code: 'auth-code-123', 
          state: 'valid-state',
          shop: 'test-store.myshopify.com'
        },
        session: {
          oauth_state: 'valid-state',
          oauth_user_id: null
        }
      };

      const mockRes = {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Act
      await handleOAuthCallback(mockReq as any, mockRes as any);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid session: No user ID found.' });
    });

    test('should complete OAuth flow when ShopifyAppService fails', async () => {
      // Arrange
      const mockReq = {
        params: { platform: 'shopify' },
        query: { 
          code: 'auth-code-123', 
          state: 'valid-state',
          shop: 'test-store.myshopify.com'
        },
        session: {
          oauth_state: 'valid-state',
          oauth_user_id: 1
        }
      };

      const mockRes = {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock successful token exchange
      axios.post.mockResolvedValue({ 
        data: { access_token: 'shopify-access-token' } 
      });

      // Mock database operations
      mockDbInstance.first
        .mockResolvedValueOnce({ id: 1, shop_id: 123 })
        .mockResolvedValueOnce({ id: 456 });

      mockDbInstance.returning.mockResolvedValueOnce([{ id: 456 }]);
      mockDbInstance.update.mockResolvedValueOnce(1);

      const mockOnConflictChain = {
        ignore: jest.fn().mockResolvedValueOnce([1])
      };
      mockDbInstance.onConflict.mockReturnValueOnce(mockOnConflictChain);

      // Mock Shopify service failure
      ShopifyAppService.completePostInstallation.mockRejectedValue(
        new Error('Script tag installation failed')
      );

      // Act
      await handleOAuthCallback(mockReq as any, mockRes as any);

      // Assert - should still redirect to success despite service failure
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/dashboard?connect=success')
      );
      expect(ShopifyAppService.completePostInstallation).toHaveBeenCalled();
    });

    test('should reject unsupported platforms', async () => {
      // Arrange
      const mockReq = {
        params: { platform: 'quickbooks' },
        query: { 
          code: 'auth-code-123', 
          state: 'valid-state'
        },
        session: {
          oauth_state: 'valid-state',
          oauth_user_id: 1
        }
      };

      const mockRes = {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock user lookup for validation
      mockDbInstance.first.mockResolvedValueOnce({ id: 1, shop_id: 123 });

      // Act
      await handleOAuthCallback(mockReq as any, mockRes as any);

      // Assert
      expect(ShopifyAppService.completePostInstallation).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unsupported platform' });
    });

    test('should handle token exchange failure', async () => {
      // Arrange
      const mockReq = {
        params: { platform: 'shopify' },
        query: { 
          code: 'auth-code-123', 
          state: 'valid-state',
          shop: 'test-store.myshopify.com'
        },
        session: {
          oauth_state: 'valid-state',
          oauth_user_id: 1
        }
      };

      const mockRes = {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock token exchange failure
      axios.post.mockRejectedValue(new Error('Network error'));

      // Mock user lookup for validation
      mockDbInstance.first.mockResolvedValueOnce({ id: 1, shop_id: 123 });

      // Act
      await handleOAuthCallback(mockReq as any, mockRes as any);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error during token exchange.' });
    });

    test('should handle missing user shop ID', async () => {
      // Arrange
      const mockReq = {
        params: { platform: 'shopify' },
        query: { 
          code: 'auth-code-123', 
          state: 'valid-state',
          shop: 'test-store.myshopify.com'
        },
        session: {
          oauth_state: 'valid-state',
          oauth_user_id: 1
        }
      };

      const mockRes = {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock successful token exchange
      axios.post.mockResolvedValue({ 
        data: { access_token: 'shopify-access-token' } 
      });

      // Mock user without shop_id
      mockDbInstance.first.mockResolvedValueOnce({ id: 1, shop_id: null });

      // Act
      await handleOAuthCallback(mockReq as any, mockRes as any);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'User account or associated shop not found.' });
    });
  });

  describe('Shopify OAuth Initiation', () => {
    test('should generate correct Shopify authorization URL', () => {
      // Arrange
      const mockReq = {
        query: { 
          platform: 'shopify',
          shop: 'test-store.myshopify.com'
        },
        session: {},
        user: { userId: 1 }
      };

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Act
      initiateOAuth(mockReq as any, mockRes as any);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        authorizationUrl: expect.stringContaining('test-store.myshopify.com')
      });
    });

    test('should normalize shop domain in authorization URL', () => {
      // Arrange
      const mockReq = {
        query: { 
          platform: 'shopify',
          shop: 'test-store' // Without .myshopify.com
        },
        session: {},
        user: { userId: 1 }
      };

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Act
      initiateOAuth(mockReq as any, mockRes as any);

      // Assert
      expect(mockRes.json).toHaveBeenCalledWith({
        authorizationUrl: expect.stringContaining('test-store.myshopify.com')
      });
    });
  });
});