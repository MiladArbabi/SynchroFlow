// tests/unit/api/dashboard-data-shapes.test.ts
import { 
  getPulse, 
  getInventoryHealth, 
  getShipmentStatus, 
  getCashTraps 
} from 'api-src/api/dashboard/dashboard.controller';

// Simple chainable mock that matches Knex behavior
const mockQueryBuilder: any = {
  where: jest.fn(() => mockQueryBuilder),
  andWhere: jest.fn(() => mockQueryBuilder),
  whereNot: jest.fn(() => mockQueryBuilder),
  orderBy: jest.fn(() => mockQueryBuilder),
  limit: jest.fn(() => mockQueryBuilder),
  select: jest.fn(() => mockQueryBuilder),
  sum: jest.fn(() => mockQueryBuilder),
  count: jest.fn(() => mockQueryBuilder),
  first: jest.fn()
};

// Mock the db function to return our mock query builders
jest.mock('api-src/db', () => ({
  __esModule: true,
  default: jest.fn(() => mockQueryBuilder)
}));

describe('Dashboard API Data Shapes', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    
    mockRequest = {
      user: { userId: 1 }
    };
    
    mockResponse = {
      status: mockStatus,
      json: mockJson
    };

    // Reset all mocks
    jest.clearAllMocks();
    mockQueryBuilder.first.mockReset();
    Object.values(mockQueryBuilder).forEach(mock => {
      if (typeof mock === 'function' && mock !== mockQueryBuilder.first) {
        jest.clearAllMocks()
      }
    });
  });

  describe('getPulse', () => {
    it('should return pulse data with correct structure', async () => {
      // Mock the database calls in sequence
      mockQueryBuilder.first
        .mockResolvedValueOnce({ shop_id: 123 }) // getShopIdFromRequest
        .mockResolvedValueOnce({ totalRevenue: '1500.50', orderCount: '15' }) // pulseData
        .mockResolvedValueOnce({ unfulfilledCount: '3' }); // unfulfilled

      await getPulse(mockRequest, mockResponse);

      expect(mockJson).toHaveBeenCalledWith({
        totalRevenue: 1500.5,
        orderCount: 15,
        unfulfilledCount: 3
      });
    });
  });

  describe('getInventoryHealth', () => {
    it('should return inventory health data with correct structure', async () => {
      const mockLowStockItems = [
        { title: 'Product A', total_inventory: 5, id: 'prod1' },
        { title: 'Product B', total_inventory: 10, id: 'prod2' }
      ];

      mockQueryBuilder.first.mockResolvedValueOnce({ shop_id: 123 });
      mockQueryBuilder.select.mockResolvedValueOnce(mockLowStockItems);

      await getInventoryHealth(mockRequest, mockResponse);

      expect(mockJson).toHaveBeenCalledWith(mockLowStockItems);
    });
  });

  describe('getShipmentStatus', () => {
    it('should return shipment status data with correct structure', async () => {
      const mockUnfulfilledOrders = [
        { 
          order_number: '1001', 
          created_at: '2023-01-01T00:00:00Z', 
          total_price: '99.99',
          id: 'order1'
        }
      ];

      mockQueryBuilder.first.mockResolvedValueOnce({ shop_id: 123 });
      mockQueryBuilder.select.mockResolvedValueOnce(mockUnfulfilledOrders);

      await getShipmentStatus(mockRequest, mockResponse);

      expect(mockJson).toHaveBeenCalledWith(mockUnfulfilledOrders);
    });
  });

  describe('getCashTraps', () => {
    it('should return cash traps data with correct structure', async () => {
      const mockCashTraps = [
        { 
          title: 'Slow Product', 
          total_inventory: 500, 
          id: 'prod1',
          variants: JSON.stringify([{ inventory_quantity: 500 }])
        }
      ];

      mockQueryBuilder.first.mockResolvedValueOnce({ shop_id: 123 });
      mockQueryBuilder.select.mockResolvedValueOnce(mockCashTraps);

      await getCashTraps(mockRequest, mockResponse);

      expect(mockJson).toHaveBeenCalledWith([
        {
          title: 'Slow Product',
          total_inventory: 500,
          id: 'prod1',
          variants: [{ inventory_quantity: 500 }]
        }
      ]);
    });
  });

  describe('Error Response Shapes', () => {
    it('should return consistent error structure for 403', async () => {
      mockQueryBuilder.first.mockResolvedValueOnce(null); // No shop_id

      await getPulse(mockRequest, mockResponse);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    it('should return consistent error structure for 500', async () => {
      mockQueryBuilder.first.mockRejectedValueOnce(new Error('DB Error'));

      await getPulse(mockRequest, mockResponse);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Failed to fetch pulse data.' });
    });
  });
});