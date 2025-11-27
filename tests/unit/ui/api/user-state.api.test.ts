// tests/unit/ui/api/user-state.api.test.ts
import { fetchUserProductCosts, updateUserProductCosts } from '../../../../packages/ui/src/api/user-state';

// Mock axiosConfig using factory pattern to avoid hoisting issues
jest.mock('../../../../packages/ui/src/api/axiosConfig', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
  };
  
  return {
    __esModule: true,
    axiosInstance: mockAxiosInstance,
  };
});

describe('UserState API - Authentication', () => {
  const mockAxiosInstance = (require('../../../../packages/ui/src/api/axiosConfig').axiosInstance as any);
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchUserProductCosts', () => {
    test('should use authenticated axiosInstance for GET requests', async () => {
      // Arrange
      const mockResponseData = {
        'product-1': {
          platform_product_id: 'product-1',
          original_platform_product_id: 'product-1',
          purchase_price: 10,
          shipping_cost: 2,
          customs_duties: 1,
          landed_cost_per_unit: 13,
          selling_price: 20,
          currency: 'USD'
        }
      };
      
      mockAxiosInstance.get.mockResolvedValue({ data: mockResponseData });

      // Act
      const result = await fetchUserProductCosts();

      // Assert
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/user-state/product-costs');
      expect(result).toEqual(mockResponseData);
    });

    test('should handle authentication errors properly', async () => {
      // Arrange
      mockAxiosInstance.get.mockRejectedValue(new Error('Unauthorized'));

      // Act & Assert
      await expect(fetchUserProductCosts()).rejects.toThrow('Unauthorized');
    });
  });

  describe('updateUserProductCosts', () => {
    test('should use authenticated axiosInstance for POST requests', async () => {
      // Arrange
      const testData = {
        'test-product': {
          platform_product_id: 'test-product',
          original_platform_product_id: 'test-product',
          purchase_price: 10,
          shipping_cost: 2,
          customs_duties: 1,
          landed_cost_per_unit: 13,
          selling_price: 20,
          currency: 'USD'
        }
      };
      
      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      // Act
      const result = await updateUserProductCosts(testData);

      // Assert
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/user-state/product-costs',
        { productCosts: testData }
      );
      expect(result).toEqual({ success: true });
    });

    test('should handle empty data gracefully', async () => {
      // Arrange
      const emptyData = {};
      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      // Act
      const result = await updateUserProductCosts(emptyData);

      // Assert
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/user-state/product-costs',
        { productCosts: emptyData }
      );
      expect(result.success).toBe(true);
    });
  });
});