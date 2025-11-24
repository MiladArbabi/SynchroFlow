// tests/unit/api/controllers/products.controller.test.ts
import { fetchProducts } from 'api-src/api/products/products.controller';
import { getProducts } from 'api-src/api/products/products.service';

// Mock the service
jest.mock('api-src/api/products/products.service');

describe('Products Controller', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockNext: any;

  beforeEach(() => {
    mockRequest = {
      query: {},
      user: { shopId: 1 }
    };
    mockResponse = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
    
    jest.clearAllMocks();
  });

  describe('fetchProducts', () => {
    it('should return products with default pagination', async () => {
      const mockProducts = {
        products: [{ id: 1, title: 'Test Product' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
      };

      (getProducts as jest.Mock).mockResolvedValue(mockProducts);

      await fetchProducts(mockRequest, mockResponse);

      expect(getProducts).toHaveBeenCalledWith(1, 20, undefined);
      expect(mockResponse.json).toHaveBeenCalledWith(mockProducts);
    });

    it('should handle custom pagination parameters', async () => {
      mockRequest.query = { page: '2', limit: '10' };
      
      await fetchProducts(mockRequest, mockResponse);

      expect(getProducts).toHaveBeenCalledWith(2, 10, undefined);
    });

    it('should handle search query', async () => {
      mockRequest.query = { search: 'snowboard' };
      
      await fetchProducts(mockRequest, mockResponse);

      expect(getProducts).toHaveBeenCalledWith(1, 20, 'snowboard');
    });

    it('should handle invalid page and limit parameters', async () => {
      mockRequest.query = { page: 'invalid', limit: 'invalid' };
      
      await fetchProducts(mockRequest, mockResponse);

      // Should default to 1 and 20
      expect(getProducts).toHaveBeenCalledWith(1, 20, undefined);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      (getProducts as jest.Mock).mockRejectedValue(error);

      await fetchProducts(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Failed to fetch products' });
    });

    it('should parse numeric parameters correctly', async () => {
      mockRequest.query = { page: '5', limit: '50' };
      
      await fetchProducts(mockRequest, mockResponse);

      expect(getProducts).toHaveBeenCalledWith(5, 50, undefined);
    });
  });
});