// tests/unit/api/dashboard.controller.test.ts
import { Request, Response } from 'express';
import db from 'api-src/db';
import { getPulse, getInventoryHealth, getShipmentStatus } from 'api-src/api/dashboard/dashboard.controller';

// Mock the database module
jest.mock('api-src/db', () => ({
  __esModule: true,
  default: jest.fn()
}));

describe('Dashboard Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
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

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('getPulse', () => {
    it('should return 403 when user has no shop', async () => {
      // Mock user query returning no shop_id
      (db as unknown as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({})
      });

      await getPulse(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    it('should return pulse data for today', async () => {
      const mockShopId = 123;
      const mockPulseData = {
        totalRevenue: '1500.50',
        orderCount: '15'
      };
      const mockUnfulfilledData = {
        unfulfilledCount: '3'
      };

      // Mock user query
      (db as unknown as jest.Mock)
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ shop_id: mockShopId })
        })
        // Mock orders query for pulse data
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          sum: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(mockPulseData)
        })
        // Mock unfulfilled orders query
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          whereNot: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(mockUnfulfilledData)
        });

      await getPulse(mockRequest as Request, mockResponse as Response);

      expect(mockJson).toHaveBeenCalledWith({
        totalRevenue: 1500.5,
        orderCount: 15,
        unfulfilledCount: 3
      });
    });

    it('should handle zero values when no data exists', async () => {
      const mockShopId = 123;

      (db as unknown as jest.Mock)
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ shop_id: mockShopId })
        })
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          sum: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null)
        })
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          whereNot: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null)
        });

      await getPulse(mockRequest as Request, mockResponse as Response);

      expect(mockJson).toHaveBeenCalledWith({
        totalRevenue: 0,
        orderCount: 0,
        unfulfilledCount: 0
      });
    });

    it('should handle database errors', async () => {
      (db as unknown as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockRejectedValue(new Error('DB Error'))
      });

      await getPulse(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Failed to fetch pulse data.' });
    });
  });

  describe('getInventoryHealth', () => {
    it('should return 403 when user has no shop', async () => {
      (db as unknown as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({})
      });

      await getInventoryHealth(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    it('should return low stock items', async () => {
        const mockShopId = 123;
        const mockLowStockItems = [
        { title: 'Product A', total_inventory: 5, id: 'prod1' }, // Changed from platform_product_id to id
        { title: 'Product B', total_inventory: 10, id: 'prod2' } // Changed from platform_product_id to id
        ];

        (db as unknown as jest.Mock)
        .mockReturnValueOnce({
            where: jest.fn().mockReturnThis(),
            first: jest.fn().mockResolvedValue({ shop_id: mockShopId })
        })
        .mockReturnValueOnce({
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue(mockLowStockItems)
        });

        await getInventoryHealth(mockRequest as Request, mockResponse as Response);

        expect(mockJson).toHaveBeenCalledWith([
        { title: 'Product A', total_inventory: 5, id: 'prod1' },
        { title: 'Product B', total_inventory: 10, id: 'prod2' }
        ]);
    });

    it('should handle database errors', async () => {
      (db as unknown as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockRejectedValue(new Error('DB Error'))
      });

      await getInventoryHealth(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Failed to fetch inventory data.' });
    });

    it('should filter only active products with inventory < 20', async () => {
      const mockShopId = 123;
      
      (db as unknown as jest.Mock)
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ shop_id: mockShopId })
        });

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      };

      (db as unknown as jest.Mock).mockReturnValue(mockQueryBuilder);

      await getInventoryHealth(mockRequest as Request, mockResponse as Response);

      // Verify the query was built correctly
      expect(mockQueryBuilder.where).toHaveBeenCalledWith({ 
        shop_id: mockShopId, 
        status: 'ACTIVE' 
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('total_inventory', '<', 20);
    });
  });

  describe('getShipmentStatus', () => {
    it('should return 403 when user has no shop', async () => {
      (db as unknown as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({})
      });

      await getShipmentStatus(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    it('should return recent unfulfilled orders', async () => {
      const mockShopId = 123;
      const mockUnfulfilledOrders = [
        { 
          order_number: '1001', 
          created_at: '2023-01-01T00:00:00Z', 
          total_price: '99.99',
          platform_order_id: 'order1'
        },
        { 
          order_number: '1002', 
          created_at: '2023-01-02T00:00:00Z', 
          total_price: '149.99',
          platform_order_id: 'order2'
        }
      ];

      (db as unknown as jest.Mock)
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ shop_id: mockShopId })
        })
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          whereNot: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          select: jest.fn().mockResolvedValue(mockUnfulfilledOrders)
        });

      await getShipmentStatus(mockRequest as Request, mockResponse as Response);

      expect(mockJson).toHaveBeenCalledWith(mockUnfulfilledOrders);
    });

    it('should handle database errors', async () => {
      (db as unknown as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockRejectedValue(new Error('DB Error'))
      });

      await getShipmentStatus(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Failed to fetch shipment data.' });
    });

    it('should query for non-fulfilled orders ordered by creation date', async () => {
      const mockShopId = 123;
      
      (db as unknown as jest.Mock)
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ shop_id: mockShopId })
        });

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue([])
      };

      (db as unknown as jest.Mock).mockReturnValue(mockQueryBuilder);

      await getShipmentStatus(mockRequest as Request, mockResponse as Response);

      // Verify the query was built correctly
      expect(mockQueryBuilder.where).toHaveBeenCalledWith({ shop_id: mockShopId });
      expect(mockQueryBuilder.whereNot).toHaveBeenCalledWith('fulfillment_status', 'FULFILLED');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing user in request', async () => {
      mockRequest.user = undefined;

      await getPulse(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'User shop not found.' });
    });

    it('should handle null database results gracefully', async () => {
      const mockShopId = 123;

      (db as unknown as jest.Mock)
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({ shop_id: mockShopId })
        })
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          sum: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null)
        })
        .mockReturnValueOnce({
          where: jest.fn().mockReturnThis(),
          whereNot: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null)
        });

      await getPulse(mockRequest as Request, mockResponse as Response);

      // Should not throw and should return zero values
      expect(mockJson).toHaveBeenCalledWith({
        totalRevenue: 0,
        orderCount: 0,
        unfulfilledCount: 0
      });
    });
  });
});