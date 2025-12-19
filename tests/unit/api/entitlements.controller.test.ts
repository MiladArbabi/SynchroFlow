// tests/unit/api/entitlements.controller.test.ts
import { EntitlementsService } from 'api/src/services/entitlements.service';
import { getMyEntitlements } from 'api/src/api/entitlements/entitlements.controller';

jest.mock('apps/backend/src/db');
jest.mock('api/src/services/entitlements.service');

describe('EntitlementsController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  
  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      user: { userId: 42 },
      headers: {},
      params: {},
      query: {},
      body: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      sendStatus: jest.fn().mockReturnThis(),
    };

    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  describe('Authentication', () => {
    it('returns 401 when no authenticated user exists', async () => {
      mockReq.user = undefined;

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
      });
      expect(EntitlementsService.getForUser).not.toHaveBeenCalled();
    });

    it('returns 401 when user exists but has no userId', async () => {
      mockReq.user = {};

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
      });
      expect(EntitlementsService.getForUser).not.toHaveBeenCalled();
    });

    it('returns 401 when userId is null', async () => {
      mockReq.user = { userId: null as any };

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(EntitlementsService.getForUser).not.toHaveBeenCalled();
    });

    it('works with different user property names if middleware adds them', async () => {
      mockReq.user = { id: 42 } as any;

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(EntitlementsService.getForUser).not.toHaveBeenCalled();
    });
  });

  describe('Service Response Handling - Happy Paths', () => {
    it('returns empty entitlements when service returns null', async () => {
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(null);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(42);
      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: null,
        modules: [],
        flags: [],
      });
    });

    it('returns entitlements from the service (happy path)', async () => {
      const mockEntitlements = {
        shopId: 123,
        modules: ['core_dashboard', 'shopify_integration'],
        flags: ['view_basic_sales', 'use_shopify_sync'],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(42);
      expect(mockRes.json).toHaveBeenCalledWith(mockEntitlements);
    });

    it('returns empty arrays when user has shop but no entitlements', async () => {
      const mockEntitlements = {
        shopId: 123,
        modules: [],
        flags: [],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(42);
      expect(mockRes.json).toHaveBeenCalledWith(mockEntitlements);
    });

    it('returns empty entitlements when service returns undefined', async () => {
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(undefined);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(42);
      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: null,
        modules: [],
        flags: [],
      });
    });
  });

  describe('User ID Edge Cases', () => {
    it('handles non-numeric userId in token', async () => {
      mockReq.user = { userId: 'not-a-number' as any };
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(null);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith('not-a-number');
    });

    it('handles zero userId', async () => {
      mockReq.user = { userId: 0 };
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(null);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(0);
      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: null,
        modules: [],
        flags: [],
      });
    });

    it('handles negative userId', async () => {
      mockReq.user = { userId: -1 };
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(null);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(-1);
    });

    it('handles very large userId', async () => {
      const largeId = 9999999999;
      mockReq.user = { userId: largeId };

      const mockEntitlements = {
        shopId: 456,
        modules: ['core_dashboard'],
        flags: ['view_basic_sales'],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(largeId);
      expect(mockRes.json).toHaveBeenCalledWith(mockEntitlements);
    });

    it('handles empty string userId', async () => {
      mockReq.user = { userId: '' as any };
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(null);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith('');
      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: null,
        modules: [],
        flags: [],
      });
    });

    it('handles user object with additional properties', async () => {
      mockReq.user = {
        userId: 42,
        email: 'test@example.com',
        name: 'Test User',
        roles: ['admin'],
        iat: 1234567890,
        exp: 1234567990,
      };

      const mockEntitlements = {
        shopId: 123,
        modules: ['core_dashboard'],
        flags: [],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(42);
      expect(mockRes.json).toHaveBeenCalledWith(mockEntitlements);
    });
  });

  describe('Service Response Data Structure Edge Cases', () => {
    it('handles duplicate modules and flags in service response', async () => {
      const mockEntitlements = {
        shopId: 123,
        modules: ['core_dashboard', 'core_dashboard', 'shopify_integration'],
        flags: ['view_basic_sales', 'view_basic_sales'],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith(mockEntitlements);
    });

    it('handles null values in modules or flags arrays', async () => {
      const mockEntitlements = {
        shopId: 123,
        modules: ['core_dashboard', null, 'shopify_integration'] as any,
        flags: [null, 'view_basic_sales', null] as any,
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith(mockEntitlements);
    });

    it('handles service returning unexpected data structure', async () => {
      const unexpectedData = {
        someOtherProperty: 'value',
        anotherProperty: 123,
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(unexpectedData as any);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: null,
        modules: [],
        flags: [],
      });
    });

    it('handles service returning partially valid data', async () => {
      const partialData = {
        shopId: 123,
        modules: 'not-an-array',
        flags: ['valid-flag'],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(partialData as any);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: 123,
        modules: [],
        flags: ['valid-flag'],
      });
    });

    it('handles service returning null shopId', async () => {
      const dataWithNullShopId = {
        shopId: null,
        modules: ['module1'],
        flags: ['flag1'],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(dataWithNullShopId);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: null,
        modules: ['module1'],
        flags: ['flag1'],
      });
    });

    it('handles service returning undefined values', async () => {
      const dataWithUndefined = {
        shopId: undefined,
        modules: undefined,
        flags: undefined,
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(dataWithUndefined);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({
        shopId: null,
        modules: [],
        flags: [],
      });
    });
  });

  describe('Error Handling', () => {
    it('handles service throwing an error', async () => {
      const error = new Error('Database connection failed');
      (EntitlementsService.getForUser as jest.Mock).mockRejectedValue(error);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(42);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
      });
      expect(console.error).toHaveBeenCalledWith('Error fetching entitlements:', error);
    });

    it('does not expose internal errors to the client', async () => {
      const error = new Error('Some internal database error with sensitive info');
      (EntitlementsService.getForUser as jest.Mock).mockRejectedValue(error);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
      });
      expect(mockRes.json).not.toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('database'),
        })
      );
    });
  });

  describe('Response Structure and Status Codes', () => {
    it('validates response structure when service returns data', async () => {
      const mockEntitlements = {
        shopId: 789,
        modules: ['module1', 'module2', 'module3'],
        flags: ['flag1', 'flag2'],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      const responseCall = (mockRes.json as jest.Mock).mock.calls[0][0];
      
      expect(responseCall).toHaveProperty('shopId');
      expect(responseCall).toHaveProperty('modules');
      expect(responseCall).toHaveProperty('flags');
      expect(Array.isArray(responseCall.modules)).toBe(true);
      expect(Array.isArray(responseCall.flags)).toBe(true);
      expect(responseCall.shopId).toBe(789);
    });

    it('returns 200 for successful responses', async () => {
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue({
        shopId: 123,
        modules: ['core_dashboard'],
        flags: [],
      });

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('returns 200 even for empty entitlements', async () => {
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(null);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('Request Validation', () => {
    it('ignores additional request properties', async () => {
      mockReq = {
        ...mockReq,
        body: { some: 'data' },
        params: { id: '123' },
        query: { filter: 'test' },
        ip: '127.0.0.1',
        method: 'GET',
        path: '/api/v1/entitlements/me',
      } as unknown as Request;

      const mockEntitlements = {
        shopId: 123,
        modules: [],
        flags: [],
      };
      
      (EntitlementsService.getForUser as jest.Mock).mockResolvedValue(mockEntitlements);

      await getMyEntitlements(mockReq as any, mockRes as any);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(42);
    });
  });

  describe('Concurrency', () => {
    it('handles concurrent requests correctly', async () => {
      const mockEntitlements1 = {
        shopId: 123,
        modules: ['core_dashboard'],
        flags: ['view_basic_sales'],
      };
      
      const mockEntitlements2 = {
        shopId: 456,
        modules: ['shopify_integration'],
        flags: ['use_shopify_sync'],
      };

      (EntitlementsService.getForUser as jest.Mock)
        .mockResolvedValueOnce(mockEntitlements1)
        .mockResolvedValueOnce(mockEntitlements2);

      const req1 = { user: { userId: 1 } } as unknown as Request;
      const req2 = { user: { userId: 2 } } as unknown as Request;
      
      const res1 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Partial<Response> as any;
      
      const res2 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Partial<Response> as any;

      await Promise.all([
        getMyEntitlements(req1 as any, res1),
        getMyEntitlements(req2 as any, res2),
      ]);

      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(1);
      expect(EntitlementsService.getForUser).toHaveBeenCalledWith(2);
      
      expect(res1.json).toHaveBeenCalledWith(mockEntitlements1);
      expect(res2.json).toHaveBeenCalledWith(mockEntitlements2);
    });
  });
});