// tests/unit/ui/api/user-state.hooks.test.ts
import { fetchUserProductCosts, updateUserProductCosts } from '../../../../apps/frontend/src/api/user-state';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('User State Cost API Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchUserProductCosts', () => {
    test('should return product costs from API', async () => {
      // Arrange
      const mockCosts = {
        'gid://shopify/Product/123': {
          productId: '1',
          platform_product_id: '123',
          original_platform_product_id: 'gid://shopify/Product/123',
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD'
        }
      };
      mockedAxios.get.mockResolvedValue({ data: mockCosts });

      // Act
      const result = await fetchUserProductCosts();

      // Assert
      expect(result).toEqual(mockCosts);
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/user-state/product-costs');
    });

    test('should handle API errors', async () => {
      // Arrange
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(fetchUserProductCosts()).rejects.toThrow('Network error');
    });
  });

  describe('updateUserProductCosts', () => {
    test('should send product costs to API', async () => {
      // Arrange
      const productCosts = {
        'gid://shopify/Product/123': {
          productId: '1',
          platform_product_id: '123',
          original_platform_product_id: 'gid://shopify/Product/123',
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD'
        }
      };
      mockedAxios.post.mockResolvedValue({ data: { success: true } });

      // Act
      const result = await updateUserProductCosts(productCosts);

      // Assert
      expect(result).toEqual({ success: true });
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/user-state/product-costs', { productCosts });
    });

    test('should handle update errors', async () => {
      // Arrange
      const productCosts = {
        'gid://shopify/Product/123': {
          productId: '1',
          platform_product_id: '123',
          original_platform_product_id: 'gid://shopify/Product/123',
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD'
        }
      };
      mockedAxios.post.mockRejectedValue(new Error('Update failed'));

      // Act & Assert
      await expect(updateUserProductCosts(productCosts)).rejects.toThrow('Update failed');
    });
  });
});