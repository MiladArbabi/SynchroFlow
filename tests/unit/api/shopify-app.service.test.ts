import { ShopifyAppService } from 'api-src/services/shopify-app.service';

// Mock database using factory pattern
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    // Chainable methods
    insert: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    
    // Terminal methods
    first: jest.fn(),
  };
  
  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };
  
  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn
  };
});

// Mock axios
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  }
}));

// Update the CryptoJS mock in the test file
jest.mock('crypto-js', () => ({
  AES: {
    encrypt: jest.fn((data, _key) => ({
      toString: () => `encrypted-${data}`
    })),
    decrypt: jest.fn((data, _key) => ({
      toString: () => data.replace('encrypted-', '')
    }))
  },
  enc: {
    Utf8: 'utf8'
  }
}));

describe('ShopifyAppService', () => {
  const mockDbInstance = (require('api-src/db').default() as any);
  const axios = require('axios').default;
  const CryptoJS = require('crypto-js');

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Restore chain methods
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.where.mockReturnValue(mockDbInstance);
    mockDbInstance.andWhere.mockReturnValue(mockDbInstance);
    mockDbInstance.update.mockReturnValue(mockDbInstance);
    mockDbInstance.returning.mockReturnValue(mockDbInstance);
  });

  describe('App Installation Tracking', () => {
    test('should create app installation record when valid data provided', async () => {
      // Arrange
      const installationData = {
        shop_id: 1,
        shop_domain: 'test-store.myshopify.com',
        access_token: 'encrypted-token-123',
        scopes: 'read_products,read_orders,write_script_tags',
        installed_at: new Date()
      };
      
      mockDbInstance.returning.mockResolvedValue([{ id: 1, ...installationData }]);

      // Act
      const result = await ShopifyAppService.createAppInstallation(installationData);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(mockDbInstance.insert).toHaveBeenCalledWith(installationData);
    });

    test('should get app installation by shop domain when installation exists', async () => {
      // Arrange
      const mockInstallation = {
        id: 1,
        shop_id: 1,
        shop_domain: 'test-store.myshopify.com',
        access_token: 'encrypted-token-123',
        installed_at: new Date(),
        uninstalled_at: null
      };
      
      mockDbInstance.first.mockResolvedValue(mockInstallation);

      // Act
      const result = await ShopifyAppService.getAppInstallation('test-store.myshopify.com');

      // Assert
      expect(result).toEqual(mockInstallation);
      expect(mockDbInstance.where).toHaveBeenCalledWith('shop_domain', 'test-store.myshopify.com');
      expect(mockDbInstance.andWhere).toHaveBeenCalledWith('uninstalled_at', null);
    });

    test('should return null when no installation found for shop domain', async () => {
      // Arrange
      mockDbInstance.first.mockResolvedValue(null);

      // Act
      const result = await ShopifyAppService.getAppInstallation('nonexistent-store.myshopify.com');

      // Assert
      expect(result).toBeNull();
    });

    test('should mark app as uninstalled when shop domain provided', async () => {
      // Arrange
      mockDbInstance.update.mockResolvedValue(1);

      // Act
      await ShopifyAppService.markAppUninstalled('test-store.myshopify.com');

      // Assert
      expect(mockDbInstance.update).toHaveBeenCalledWith({
        uninstalled_at: expect.any(Date)
      });
      expect(mockDbInstance.where).toHaveBeenCalledWith('shop_domain', 'test-store.myshopify.com');
    });
  });

  describe('Script Tag Management', () => {
    test('should install Specter SDK script tag when valid credentials provided', async () => {
      // Arrange
      const shopDomain = 'test-store.myshopify.com';
      const accessToken = 'test-access-token';
      
      axios.post.mockResolvedValue({ data: {} });

      // Act
      await ShopifyAppService.installSpecterSDK(shopDomain, accessToken);

      // Assert
      expect(axios.post).toHaveBeenCalledWith(
        `https://${shopDomain}/admin/api/2024-01/script_tags.json`,
        {
          script_tag: {
            event: 'onload',
            src: 'https://cdn.lasyncro.com/specter-sdk-v1.js',
            display_scope: 'online_store'
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
    });

    test('should throw error when script tag installation fails', async () => {
      // Arrange
      const shopDomain = 'invalid-store.myshopify.com';
      const accessToken = 'invalid-token';
      
      axios.post.mockRejectedValue(new Error('API Error'));

      // Act & Assert
      await expect(ShopifyAppService.installSpecterSDK(shopDomain, accessToken))
        .rejects.toThrow('Failed to install Specter SDK script tag');
    });
  });

  describe('Webhook Management', () => {
    test('should register app uninstall webhook when valid credentials provided', async () => {
      // Arrange
      const shopDomain = 'test-store.myshopify.com';
      const accessToken = 'test-access-token';
      
      axios.post.mockResolvedValue({ data: {} });

      // Act
      await ShopifyAppService.registerAppUninstallWebhook(shopDomain, accessToken);

      // Assert
      expect(axios.post).toHaveBeenCalledWith(
        `https://${shopDomain}/admin/api/2024-01/webhooks.json`,
        {
          webhook: {
            topic: 'app/uninstalled',
            address: `${process.env.API_URL}/api/v1/shopify/webhooks/app-uninstalled`,
            format: 'json'
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
    });

    test('should throw error when webhook registration fails', async () => {
      // Arrange
      const shopDomain = 'invalid-store.myshopify.com';
      const accessToken = 'invalid-token';
      
      axios.post.mockRejectedValue(new Error('API Error'));

      // Act & Assert
      await expect(ShopifyAppService.registerAppUninstallWebhook(shopDomain, accessToken))
        .rejects.toThrow('Failed to register app uninstall webhook');
    });
  });

  describe('Post-Installation Setup', () => {
    test('should complete post-installation setup when new installation', async () => {
      // Arrange
      const shopDomain = 'test-store.myshopify.com';
      const accessToken = 'test-access-token';
      const shopId = 1;
      
      axios.post.mockResolvedValue({ data: {} });
      mockDbInstance.first.mockResolvedValue(null); // No existing installation
      mockDbInstance.returning.mockResolvedValue([{ id: 1 }]);

      // Act
      await ShopifyAppService.completePostInstallation(shopDomain, accessToken, shopId);

      // Assert
      expect(axios.post).toHaveBeenCalledTimes(2); // Script tag + webhook
      expect(mockDbInstance.insert).toHaveBeenCalledWith({
        shop_id: shopId,
        shop_domain: shopDomain,
        access_token: 'encrypted-test-access-token', // Now matches the mock
        scopes: 'read_products,read_orders,read_customers,read_inventory,read_fulfillments,write_script_tags',
        installed_at: expect.any(Date)
      });
    });

    test('should skip installation record creation when installation already exists', async () => {
      // Arrange
      const shopDomain = 'test-store.myshopify.com';
      const accessToken = 'test-access-token';
      const shopId = 1;
      
      axios.post.mockResolvedValue({ data: {} });
      mockDbInstance.first.mockResolvedValue({ id: 1 }); // Existing installation

      // Act
      await ShopifyAppService.completePostInstallation(shopDomain, accessToken, shopId);

      // Assert
      expect(axios.post).toHaveBeenCalledTimes(2); // Script tag + webhook
      expect(mockDbInstance.insert).not.toHaveBeenCalled();
    });
  });

  describe('Access Token Security', () => {
    test('should encrypt access token when encryption key available', () => {
      // Arrange
      process.env.ENCRYPTION_KEY = 'test-key';
      const plainToken = 'plain-access-token';

      // Act
      const result = ShopifyAppService.encryptToken(plainToken);

      // Assert
      expect(result).toBe('encrypted-plain-access-token');
      expect(CryptoJS.AES.encrypt).toHaveBeenCalledWith(plainToken, 'test-key');
    });

    test('should decrypt access token when installation exists', async () => {
      // Arrange
      process.env.ENCRYPTION_KEY = 'test-key';
      const mockInstallation = {
        id: 1,
        access_token: 'encrypted-test-token'
      };
      
      mockDbInstance.first.mockResolvedValue(mockInstallation);

      // Act
      const result = await ShopifyAppService.getDecryptedAccessToken('test-store.myshopify.com');

      // Assert
      expect(result).toBe('test-token'); // Removes the 'encrypted-' prefix
      expect(CryptoJS.AES.decrypt).toHaveBeenCalledWith('encrypted-test-token', 'test-key');
    });

    test('should throw error when encryption key missing', () => {
      // Arrange
      delete process.env.ENCRYPTION_KEY;
      const plainToken = 'plain-access-token';

      // Act & Assert
      expect(() => ShopifyAppService.encryptToken(plainToken))
        .toThrow('ENCRYPTION_KEY is not set in environment.');
    });

    test('should return null when no installation found for decryption', async () => {
      // Arrange
      mockDbInstance.first.mockResolvedValue(null);

      // Act
      const result = await ShopifyAppService.getDecryptedAccessToken('nonexistent-store.myshopify.com');

      // Assert
      expect(result).toBeNull();
    });
  });
});