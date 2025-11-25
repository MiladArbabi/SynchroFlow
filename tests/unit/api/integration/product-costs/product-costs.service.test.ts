// tests/unit/api/services/product-costs.service.test.ts
import { 
  getProductCost, 
  upsertProductCost, 
  deleteProductCost 
} from '../../../../../packages/api/src/api/product-costs/product-costs.service';

// Mock the database using factory pattern to avoid hoisting issues
jest.mock('../../../../../packages/api/src/db', () => {
  const mockChain = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis()
  };
  return {
    __esModule: true,
    default: jest.fn(() => mockChain)
  };
});

// Create type-safe reference after jest.mock
const mockDb = require('../../../../../packages/api/src/db').default as jest.MockedFunction<any>;

describe('Product Costs Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the mock chain methods
    const mockInstance = mockDb();
    mockInstance.where.mockReturnValue(mockInstance);
    mockInstance.insert.mockReturnValue(mockInstance);
    mockInstance.onConflict.mockReturnValue(mockInstance);
    mockInstance.merge.mockReturnValue(mockInstance);
    mockInstance.returning.mockReturnValue(mockInstance);
    mockInstance.delete.mockReturnValue(mockInstance);
  });

  describe('getProductCost', () => {
    test('should return product cost when found', async () => {
      // Arrange
      const mockCost = {
        platform_product_id: 'prod_123',
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };
      const mockInstance = mockDb();
      mockInstance.first.mockResolvedValue(mockCost);

      // Act
      const result = await getProductCost('prod_123');

      // Assert
      expect(result).toEqual(mockCost);
      expect(mockInstance.where).toHaveBeenCalledWith('platform_product_id', 'prod_123');
      expect(mockInstance.first).toHaveBeenCalled();
    });

    test('should return null when product cost not found', async () => {
      // Arrange
      const mockInstance = mockDb();
      mockInstance.first.mockResolvedValue(null);

      // Act
      const result = await getProductCost('prod_999');

      // Assert
      expect(result).toBeNull();
      expect(mockInstance.where).toHaveBeenCalledWith('platform_product_id', 'prod_999');
    });
  });

  describe('upsertProductCost', () => {
    test('should upsert product cost successfully', async () => {
      // Arrange
      const mockCost = {
        platform_product_id: 'prod_123',
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };
      const mockInstance = mockDb();
      mockInstance.returning.mockResolvedValue([mockCost]);

      // Act
      const result = await upsertProductCost('prod_123', 25.50, 30.00);

      // Assert
      expect(result).toEqual(mockCost);
      expect(mockInstance.insert).toHaveBeenCalledWith({
        platform_product_id: 'prod_123',
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00,
        created_at: expect.any(String),
        updated_at: expect.any(String)
      });
      expect(mockInstance.onConflict).toHaveBeenCalledWith('platform_product_id');
      expect(mockInstance.merge).toHaveBeenCalledWith({
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00,
        updated_at: expect.any(String)
      });
    });
  });

  describe('deleteProductCost', () => {
    test('should return true when product cost is deleted', async () => {
      // Arrange
      const mockInstance = mockDb();
      mockInstance.delete.mockResolvedValue(1);

      // Act
      const result = await deleteProductCost('prod_123');

      // Assert
      expect(result).toBe(true);
      expect(mockInstance.where).toHaveBeenCalledWith('platform_product_id', 'prod_123');
    });

    test('should return false when product cost not found', async () => {
      // Arrange
      const mockInstance = mockDb();
      mockInstance.delete.mockResolvedValue(0);

      // Act
      const result = await deleteProductCost('prod_999');

      // Assert
      expect(result).toBe(false);
    });
  });
});