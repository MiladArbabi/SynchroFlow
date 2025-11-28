// tests/unit/services/shopify-app.service.integration.test.ts
import { ShopifyAppService } from 'api-src/services/shopify-app.service';

// Mock database using factory pattern
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    insert: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
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

describe('ShopifyAppService - Integration Scenarios', () => {
  let mockDbInstance: any;
  let axios: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDbInstance = (require('api-src/db').default() as any);
    axios = require('axios').default;

    // Reset chain methods
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.where.mockReturnValue(mockDbInstance);
    mockDbInstance.andWhere.mockReturnValue(mockDbInstance);
    mockDbInstance.first.mockReturnValue(mockDbInstance);
  });

  test('should install free tier SDK with analytics-only script', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await ShopifyAppService.installSpecterSDK(
      'test-store.myshopify.com',
      'test-access-token',
      123,
      'free'
    );

    expect(axios.post).toHaveBeenCalledWith(
      'https://test-store.myshopify.com/admin/api/2024-01/script_tags.json',
      {
        script_tag: {
          event: 'onload',
          src: 'https://cdn.lasyncro.com/specter-analytics-v1.js',
          display_scope: 'online_store'
        }
      },
      expect.any(Object)
    );
  });

  test('should install specter tier SDK with full features script', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await ShopifyAppService.installSpecterSDK(
      'test-store.myshopify.com',
      'test-access-token',
      123,
      'specter'
    );

    expect(axios.post).toHaveBeenCalledWith(
      'https://test-store.myshopify.com/admin/api/2024-01/script_tags.json',
      {
        script_tag: {
          event: 'onload',
          src: 'https://cdn.lasyncro.com/specter-sdk-v1.js',
          display_scope: 'online_store'
        }
      },
      expect.any(Object)
    );
  });

  test('should handle installation errors gracefully', async () => {
    axios.post.mockRejectedValue(new Error('Shopify API Error'));

    await expect(
      ShopifyAppService.installSpecterSDK(
        'test-store.myshopify.com',
        'test-access-token',
        123,
        'specter'
      )
    ).rejects.toThrow('Failed to install Specter SDK script tag');
  });

  test('should generate different scripts for different tiers', async () => {
    const freeScript = await ShopifyAppService.createSpecterScript('shop-123', 'free');
    const specterScript = await ShopifyAppService.createSpecterScript('shop-123', 'specter');

    expect(freeScript).toContain('"moduleTier":"free"');
    expect(specterScript).toContain('"moduleTier":"specter"');
    expect(freeScript).not.toBe(specterScript);
  });
});