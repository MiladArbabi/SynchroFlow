import { CustomerResolutionService, PlatformCustomer } from '../../../packages/api/src/services/customer-resolution.service';

// Mock the database
const mockDbInstance = {
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  select: jest.fn().mockReturnThis(),
};

jest.mock('../../../packages/api/src/db', () => ({
  __esModule: true,
  default: jest.fn(() => mockDbInstance)
}));

describe('CustomerResolutionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockDbInstance).forEach(mock => mock.mockClear?.());
    mockDbInstance.where.mockReturnValue(mockDbInstance);
    mockDbInstance.select.mockReturnValue(mockDbInstance);
  });

  describe('resolveCustomerIdentity', () => {
    test('should resolve identity with high confidence for matching platform data', async () => {
      // Arrange
      const shopId = 1;
      const email = 'test@example.com';
      const platformData: PlatformCustomer[] = [
        {
          platform: 'shopify',
          platform_customer_id: 'shopify_123',
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+1234567890'
        },
        {
          platform: 'klaviyo', 
          platform_customer_id: 'klaviyo_456',
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+1234567890'
        }
      ];

      // Act
      const result = await CustomerResolutionService.resolveCustomerIdentity(shopId, email, platformData);

      // Assert
      expect(result.unified_customer_id).toBeDefined();
      expect(result.primary_email).toBe('test@example.com');
      expect(result.resolved_identity.name).toBe('John Doe');
      expect(result.confidence_score).toBeGreaterThan(0.7);
      expect(result.resolution_methods).toContain('email_exact_match');
    });

    test('should handle single platform with lower confidence', async () => {
      // Arrange
      const shopId = 1;
      const email = 'test@example.com';
      const platformData: PlatformCustomer[] = [
        {
          platform: 'shopify',
          platform_customer_id: 'shopify_123',
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe'
        }
      ];

      // Act
      const result = await CustomerResolutionService.resolveCustomerIdentity(shopId, email, platformData);

      // Assert
      expect(result.confidence_score).toBeLessThan(0.5);
      expect(result.resolution_methods).toContain('single_platform');
    });

    test('should generate consistent unified IDs for same input', async () => {
      // Arrange
      const shopId = 1;
      const email = 'test@example.com';
      const platformData: PlatformCustomer[] = [];

      // Act
      const result1 = await CustomerResolutionService.resolveCustomerIdentity(shopId, email, platformData);
      const result2 = await CustomerResolutionService.resolveCustomerIdentity(shopId, email, platformData);

      // Assert
      expect(result1.unified_customer_id).toBe(result2.unified_customer_id);
    });
  });

  describe('findCustomersByEmail', () => {
    test('should return null when no customers found', async () => {
      // Arrange
      mockDbInstance.first.mockResolvedValue(null);

      // Act
      const result = await CustomerResolutionService.findCustomersByEmail(1, 'nonexistent@example.com');

      // Assert
      expect(result).toBeNull();
      expect(mockDbInstance.where).toHaveBeenCalledWith({ shop_id: 1, email: 'nonexistent@example.com' });
    });

    test('should resolve identity when Shopify customer found', async () => {
      // Arrange
      const shopifyCustomer = {
        shop_id: 1,
        platform_customer_id: 'shopify_123',
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890',
        total_orders: 5,
        total_spent: 1000,
        state: 'enabled',
        tags: 'VIP'
      };
      mockDbInstance.first.mockResolvedValue(shopifyCustomer);

      // Act
      const result = await CustomerResolutionService.findCustomersByEmail(1, 'test@example.com');

      // Assert
      expect(result).not.toBeNull();
      expect(result?.unified_customer_id).toBeDefined();
      expect(result?.platforms).toHaveLength(1);
      expect(result?.platforms[0].platform).toBe('shopify');
    });
  });

  describe('getShopUnifiedCustomers', () => {
    test('should return empty array for shop with no customers', async () => {
      // Arrange
      mockDbInstance.select.mockResolvedValue([]);

      // Act
      const result = await CustomerResolutionService.getShopUnifiedCustomers(1);

      // Assert
      expect(result).toEqual([]);
      expect(mockDbInstance.where).toHaveBeenCalledWith({ shop_id: 1 });
    });

    test('should resolve identities for multiple customers', async () => {
      // Arrange
      const shopifyCustomers = [
        {
          email: 'customer1@example.com',
          platform_customer_id: 'shopify_123',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+1234567890'
        },
        {
          email: 'customer2@example.com', 
          platform_customer_id: 'shopify_456',
          first_name: 'Jane',
          last_name: 'Smith',
          phone: '+0987654321'
        }
      ];
      mockDbInstance.select.mockResolvedValue(shopifyCustomers);

      // Act
      const result = await CustomerResolutionService.getShopUnifiedCustomers(1);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].unified_customer_id).toBeDefined();
      expect(result[1].unified_customer_id).toBeDefined();
      expect(result[0].primary_email).toBe('customer1@example.com');
      expect(result[1].primary_email).toBe('customer2@example.com');
    });
  });

  describe('confidence scoring', () => {
    test('should give high score for multiple platforms with matching data', async () => {
      // Arrange
      const platformData: PlatformCustomer[] = [
        {
          platform: 'shopify',
          platform_customer_id: 'shopify_123',
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+1234567890'
        },
        {
          platform: 'klaviyo',
          platform_customer_id: 'klaviyo_456', 
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+1234567890'
        },
        {
          platform: 'stripe',
          platform_customer_id: 'stripe_789',
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe'
        }
      ];

      // Act
      const result = await CustomerResolutionService.resolveCustomerIdentity(1, 'test@example.com', platformData);

      // Assert
      expect(result.confidence_score).toBeGreaterThan(0.8);
    });

    test('should give lower score for conflicting data', async () => {
      // Arrange
      const platformData: PlatformCustomer[] = [
        {
          platform: 'shopify',
          platform_customer_id: 'shopify_123',
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe'
        },
        {
          platform: 'klaviyo',
          platform_customer_id: 'klaviyo_456',
          email: 'test@example.com', 
          first_name: 'Jane',  // Different first name
          last_name: 'Smith'   // Different last name
        }
      ];

      // Act
      const result = await CustomerResolutionService.resolveCustomerIdentity(1, 'test@example.com', platformData);

      // Assert
      expect(result.confidence_score).toBeLessThan(0.6);
    });
  });
});