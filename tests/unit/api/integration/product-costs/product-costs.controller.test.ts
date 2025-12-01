// tests/unit/api/controllers/product-costs.controller.test.ts
import {
  getProductCostHandler,
  upsertProductCostHandler,
  deleteProductCostHandler
} from 'api-src/api/product-costs/product-costs.controller';

// Mock the service
jest.mock('api-src/api/product-costs/product-costs.service', () => ({
  getProductCost: jest.fn(),
  upsertProductCost: jest.fn(),
  deleteProductCost: jest.fn()
}));

import {
  getProductCost,
  upsertProductCost,
  deleteProductCost
} from 'api-src/api/product-costs/product-costs.service';

describe('Product Costs Controller', () => {
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(() => {
    mockRequest = {
      params: {},
      body: {}
    };
    mockResponse = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn()
    };
    jest.clearAllMocks();
  });

  describe('getProductCostHandler', () => {
    test('should return product cost when found', async () => {
      // Arrange
      mockRequest.params.platformProductId = 'prod_123';
      const mockCost = {
        platform_product_id: 'prod_123',
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00
      };
      (getProductCost as jest.Mock).mockResolvedValue(mockCost);

      // Act
      await getProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(getProductCost).toHaveBeenCalledWith('prod_123');
      expect(mockResponse.json).toHaveBeenCalledWith(mockCost);
    });

    test('should return 404 when product cost not found', async () => {
      // Arrange
      mockRequest.params.platformProductId = 'prod_999';
      (getProductCost as jest.Mock).mockResolvedValue(null);

      // Act
      await getProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Product cost not found' });
    });

    test('should return 400 when platformProductId is missing', async () => {
      // Arrange
      mockRequest.params.platformProductId = '';

      // Act
      await getProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'platformProductId is required' });
    });
  });

  describe('upsertProductCostHandler', () => {
    test('should upsert product cost successfully', async () => {
      // Arrange
      mockRequest.params.platformProductId = 'prod_123';
      mockRequest.body = {
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00
      };
      const mockCost = {
        platform_product_id: 'prod_123',
        purchase_price: 25.50,
        landed_cost_per_unit: 30.00
      };
      (upsertProductCost as jest.Mock).mockResolvedValue(mockCost);

      // Act
      await upsertProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(upsertProductCost).toHaveBeenCalledWith('prod_123', 25.50, 30.00);
      expect(mockResponse.json).toHaveBeenCalledWith(mockCost);
    });

    test('should return 400 for invalid purchase_price', async () => {
      // Arrange
      mockRequest.params.platformProductId = 'prod_123';
      mockRequest.body = {
        purchase_price: -10,
        landed_cost_per_unit: 30.00
      };

      // Act
      await upsertProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Valid purchase_price is required' });
    });

    test('should return 400 for invalid landed_cost_per_unit', async () => {
      // Arrange
      mockRequest.params.platformProductId = 'prod_123';
      mockRequest.body = {
        purchase_price: 25.50,
        landed_cost_per_unit: -5
      };

      // Act
      await upsertProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Valid landed_cost_per_unit is required' });
    });
  });

  describe('deleteProductCostHandler', () => {
    test('should delete product cost successfully', async () => {
      // Arrange
      mockRequest.params.platformProductId = 'prod_123';
      (deleteProductCost as jest.Mock).mockResolvedValue(true);

      // Act
      await deleteProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(deleteProductCost).toHaveBeenCalledWith('prod_123');
      expect(mockResponse.status).toHaveBeenCalledWith(204);
      expect(mockResponse.send).toHaveBeenCalled();
    });

    test('should return 404 when product cost not found for deletion', async () => {
      // Arrange
      mockRequest.params.platformProductId = 'prod_999';
      (deleteProductCost as jest.Mock).mockResolvedValue(false);

      // Act
      await deleteProductCostHandler(mockRequest, mockResponse);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Product cost not found' });
    });
  });
});