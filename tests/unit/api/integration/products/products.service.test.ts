// tests/unit/api/services/products.service.test.ts
import { getProducts } from 'api-src/api/products/products.service';

// Mock the database
let mockQueryBuilder: any;

jest.mock('api-src/db', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockQueryBuilder)
}));

describe('Products Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create fresh mock for each test
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockResolvedValue([]),
      select: jest.fn().mockReturnThis(),
      count: jest.fn().mockReturnThis(),
      first: jest.fn(),
      clone: jest.fn().mockImplementation(() => ({
        ...mockQueryBuilder,
        first: jest.fn().mockResolvedValue({ count: '1' })
      }))
    };
  });

describe('Products Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return products with pagination', async () => {
    const mockProducts = [{
        id: 1, shop_id: 1, platform_product_id: 'gid://shopify/Product/1',
        title: 'Test Product', vendor: 'Test Vendor', product_type: 'Test Type',
        status: 'ACTIVE', total_inventory: 10,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }];

    // Mock the final offset call to return products
    (mockQueryBuilder.offset as jest.Mock).mockResolvedValueOnce(mockProducts);

    const result = await getProducts(1, 20);

    expect(result).toEqual({
        products: mockProducts,
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
    });
    });

    it('should handle search query', async () => {
        // Mock count query
        (mockQueryBuilder.first as jest.Mock).mockResolvedValueOnce({ count: '1' });
        // Mock products query
        (mockQueryBuilder.offset as jest.Mock).mockResolvedValueOnce([]);

        await getProducts(1, 20, 'snowboard');

        expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
        // Should search in title, vendor, and product_type
    });

    it('should handle empty results', async () => {
        // Override the clone mock to return count 0 for this test
        mockQueryBuilder.clone.mockImplementation(() => ({
            ...mockQueryBuilder,
            first: jest.fn().mockResolvedValue({ count: '0' })
        }));
        
        // Mock products query
        (mockQueryBuilder.offset as jest.Mock).mockResolvedValueOnce([]);

        const result = await getProducts(1, 20, 'nonexistent');

        expect(result.products).toEqual([]);
        expect(result.pagination.total).toBe(0);
        expect(result.pagination.totalPages).toBe(0);
    });

    it('should calculate pagination correctly for multiple pages', async () => {
    const mockProducts = Array(20).fill({});
    
    // Override the clone mock to return count 45 for this test
    mockQueryBuilder.clone.mockImplementation(() => ({
        ...mockQueryBuilder,
        first: jest.fn().mockResolvedValue({ count: '45' })
    }));
    
    // Mock products query
    (mockQueryBuilder.offset as jest.Mock).mockResolvedValueOnce(mockProducts);

    const result = await getProducts(3, 20);

    expect(result.pagination).toEqual({
        page: 3,
        limit: 20,
        total: 45,
        totalPages: 3
    });
    expect(mockQueryBuilder.offset).toHaveBeenCalledWith(40); // (3-1)*20 = 40
    });

    it('should handle database errors', async () => {
    // Override the clone mock to throw an error for this test
    mockQueryBuilder.clone.mockImplementation(() => ({
        ...mockQueryBuilder,
        first: jest.fn().mockRejectedValue(new Error('Database error'))
    }));

    await expect(getProducts(1, 20)).rejects.toThrow('Database error');
    });
  });
});