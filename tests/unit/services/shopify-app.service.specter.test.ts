// tests/unit/services/shopify-app.service.specter.test.ts
import { ShopifyAppService } from 'api-src/services/shopify-app.service';

// Mock the database using factory pattern
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

// Mock the SpecterSDKService
jest.mock('api-src/services/specter-sdk.service', () => ({
  SpecterSDKService: jest.fn().mockImplementation(() => ({
    getConfig: jest.fn().mockReturnValue({
      moduleTier: 'specter',
      features: {
        sessionTracking: true,
        basicNudges: true,
        exitIntent: true,
        surgicalDiscounts: false
      }
    })
  }))
}));

describe('ShopifyAppService - Specter Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should generate Specter SDK configuration for free tier', async () => {
    const config = await ShopifyAppService.generateSpecterConfig('free');
    
    expect(config.moduleTier).toBe('free');
    expect(config.features.basicNudges).toBe(false);
    expect(config.features.exitIntent).toBe(false);
  });

  test('should generate Specter SDK configuration for specter tier', async () => {
    const config = await ShopifyAppService.generateSpecterConfig('specter');
    
    expect(config.moduleTier).toBe('specter');
    expect(config.features.basicNudges).toBe(true);
    expect(config.features.exitIntent).toBe(true);
  });

  test('should create Specter SDK script with configuration', async () => {
    const script = await ShopifyAppService.createSpecterScript('test-shop-123', 'specter');
    
    expect(script).toContain('window.SpecterSDKConfig');
    expect(script).toContain('test-shop-123');
    expect(script).toContain('specter');
    expect(script).toContain('"basicNudges":true'); // Fixed: JSON stringification removes spaces
    });
});