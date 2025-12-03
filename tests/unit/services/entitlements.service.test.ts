// tests/unit/services/entitlements.service.test.ts
import db from 'api-src/db';
import { EntitlementsService } from 'api-src/services/entitlements.service';

jest.mock('api-src/db');

const mockedDb = db as unknown as jest.Mock;

describe('EntitlementsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getForUser', () => {
    it('returns null when user is not found or has no shop_id', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue(null);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);

      expect(mockUsersWhere).toHaveBeenCalledWith({ id: 1 });
      expect(mockUsersFirst).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns empty arrays when user has shop but no entitlements', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: 123,
      });

      const mockEntWhere = jest.fn().mockReturnThis();
      const mockEntSelect = jest.fn().mockResolvedValue([]);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        if (table === 'shop_module_entitlements') {
          return {
            where: mockEntWhere,
            select: mockEntSelect,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);

      expect(result).toEqual({
        shopId: 123,
        modules: [],
        flags: [],
      });
    });

    it('returns entitlements for a user with a shop and rows in shop_module_entitlements', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: 123,
      });

      const mockEntWhere = jest.fn().mockReturnThis();
      const mockEntSelect = jest.fn().mockResolvedValue([
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: 'view_basic_sales',
        },
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: 'view_recent_orders_widget',
        },
        {
          shop_id: 123,
          module_key: 'shopify_integration',
          flag_key: 'use_shopify_sync',
        },
        {
          shop_id: 123,
          module_key: 'specter_sdk_free',
          flag_key: null,
        },
      ]);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        if (table === 'shop_module_entitlements') {
          return {
            where: mockEntWhere,
            select: mockEntSelect,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);

      expect(mockUsersWhere).toHaveBeenCalledWith({ id: 1 });
      expect(mockUsersFirst).toHaveBeenCalled();

      expect(mockEntWhere).toHaveBeenCalledWith({ shop_id: 123 });
      expect(mockEntSelect).toHaveBeenCalled();

      expect(result).not.toBeNull();
      expect(result?.shopId).toBe(123);

      // modules should contain unique module keys
      expect(result?.modules).toEqual(
        expect.arrayContaining([
          'core_dashboard',
          'shopify_integration',
          'specter_sdk_free',
        ]),
      );
      expect(result?.modules?.length).toBe(3);

      // flags should contain all non-null flags
      expect(result?.flags).toEqual(
        expect.arrayContaining([
          'view_basic_sales',
          'view_recent_orders_widget',
          'use_shopify_sync',
        ]),
      );
      expect(result?.flags?.length).toBe(3);
    });

    it('handles duplicate module keys by returning unique values', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: 123,
      });

      const mockEntWhere = jest.fn().mockReturnThis();
      const mockEntSelect = jest.fn().mockResolvedValue([
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: 'view_basic_sales',
        },
        {
          shop_id: 123,
          module_key: 'core_dashboard', // Duplicate
          flag_key: 'another_flag',
        },
        {
          shop_id: 123,
          module_key: 'core_dashboard', // Another duplicate
          flag_key: null,
        },
      ]);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        if (table === 'shop_module_entitlements') {
          return {
            where: mockEntWhere,
            select: mockEntSelect,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);

      expect(result?.modules).toEqual(['core_dashboard']);
      expect(result?.modules.length).toBe(1);
    });

    it('handles duplicate flag keys by returning unique values', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: 123,
      });

      const mockEntWhere = jest.fn().mockReturnThis();
      const mockEntSelect = jest.fn().mockResolvedValue([
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: 'view_basic_sales',
        },
        {
          shop_id: 123,
          module_key: 'another_module',
          flag_key: 'view_basic_sales', // Duplicate flag
        },
      ]);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        if (table === 'shop_module_entitlements') {
          return {
            where: mockEntWhere,
            select: mockEntSelect,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);

      expect(result?.flags).toEqual(['view_basic_sales']);
      expect(result?.flags.length).toBe(1);
    });

    it('handles mixed null and non-null flag keys correctly', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: 123,
      });

      const mockEntWhere = jest.fn().mockReturnThis();
      const mockEntSelect = jest.fn().mockResolvedValue([
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: null, // Should be ignored for flags
        },
        {
          shop_id: 123,
          module_key: 'shopify_integration',
          flag_key: 'use_shopify_sync', // CORRECTED: was 'use_shopify_sales'
        },
        {
          shop_id: 123,
          module_key: 'another_module',
          flag_key: null, // Should be ignored for flags
        },
      ]);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        if (table === 'shop_module_entitlements') {
          return {
            where: mockEntWhere,
            select: mockEntSelect,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);

      // Only non-null flags should be included
      expect(result?.flags).toEqual(['use_shopify_sync']);
      expect(result?.flags.length).toBe(1);
      
      // All modules should be included regardless of flag null status
      expect(result?.modules).toEqual(
        expect.arrayContaining([
          'core_dashboard',
          'shopify_integration',
          'another_module',
        ]),
      );
      expect(result?.modules.length).toBe(3);
    });

    it('handles database errors gracefully', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockRejectedValue(
        new Error('Database connection failed')
      );

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        return {};
      });

      await expect(EntitlementsService.getForUser(1)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('handles database errors when fetching entitlements', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: 123,
      });

      const mockEntWhere = jest.fn().mockReturnThis();
      const mockEntSelect = jest.fn().mockRejectedValue(
        new Error('Failed to fetch entitlements')
      );

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        if (table === 'shop_module_entitlements') {
          return {
            where: mockEntWhere,
            select: mockEntSelect,
          };
        }
        return {};
      });

      await expect(EntitlementsService.getForUser(1)).rejects.toThrow(
        'Failed to fetch entitlements'
      );
    });

    it('returns empty arrays when rows is null or undefined', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: 123,
      });

      const mockEntWhere = jest.fn().mockReturnThis();
      const mockEntSelect = jest.fn().mockResolvedValue(null); // null case

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        if (table === 'shop_module_entitlements') {
          return {
            where: mockEntWhere,
            select: mockEntSelect,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);
      expect(result).toEqual({
        shopId: 123,
        modules: [],
        flags: [],
      });
    });

    it('handles user with null shop_id', async () => {
      const mockUsersWhere = jest.fn().mockReturnThis();
      const mockUsersFirst = jest.fn().mockResolvedValue({
        id: 1,
        shop_id: null,
      });

      mockedDb.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            where: mockUsersWhere,
            first: mockUsersFirst,
          };
        }
        return {};
      });

      const result = await EntitlementsService.getForUser(1);
      expect(result).toBeNull();
    });
  });

  describe('grantDefaultFreeTierForShop', () => {
    it('inserts the default FT0 entitlements bundle for a shop with upsert semantics', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue(undefined);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      await EntitlementsService.grantDefaultFreeTierForShop(123);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const payload = mockInsert.mock.calls[0][0];

      // We expect an array of rows
      expect(Array.isArray(payload)).toBe(true);

      // Check that the core modules are present
      expect(payload).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            shop_id: 123,
            module_key: 'core_dashboard',
            source: 'free_tier_default',
          }),
          expect.objectContaining({
            shop_id: 123,
            module_key: 'shopify_integration',
            source: 'free_tier_default',
          }),
          expect.objectContaining({
            shop_id: 123,
            module_key: 'specter_sdk_free',
            source: 'free_tier_default',
          }),
        ]),
      );

      // Check that some key flags exist (we don't assert the full set here on purpose)
      expect(payload).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            shop_id: 123,
            module_key: 'core_dashboard',
            flag_key: 'view_basic_sales',
          }),
          expect.objectContaining({
            shop_id: 123,
            module_key: 'shopify_integration',
            flag_key: 'use_shopify_sync',
          }),
        ]),
      );

      // Verify all rows have the correct shop_id
      payload.forEach((row: any) => {
        expect(row.shop_id).toBe(123);
        expect(row.source).toBe('free_tier_default');
      });

      // Verify there are no duplicate combinations in the payload
      const uniqueCombos = new Set(
        payload.map((row: any) => `${row.module_key}-${row.flag_key}`)
      );
      expect(uniqueCombos.size).toBe(payload.length);

      // Upsert semantics on (shop_id, module_key, flag_key)
      expect(mockOnConflict).toHaveBeenCalledWith([
        'shop_id',
        'module_key',
        'flag_key',
      ]);
      expect(mockIgnore).toHaveBeenCalled();
    });

    it('handles database insertion errors gracefully', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockRejectedValue(
        new Error('Insert failed')
      );

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      await expect(
        EntitlementsService.grantDefaultFreeTierForShop(123)
      ).rejects.toThrow('Insert failed');
    });

    it('is idempotent - calling multiple times should not fail', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue(undefined);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      // Call the method multiple times
      await EntitlementsService.grantDefaultFreeTierForShop(123);
      await EntitlementsService.grantDefaultFreeTierForShop(123);
      await EntitlementsService.grantDefaultFreeTierForShop(123);

      // Should be called 3 times but with conflict handling
      expect(mockInsert).toHaveBeenCalledTimes(3);
      expect(mockOnConflict).toHaveBeenCalledTimes(3);
      expect(mockIgnore).toHaveBeenCalledTimes(3);

      // Each call should have the same payload
      const firstPayload = mockInsert.mock.calls[0][0];
      const secondPayload = mockInsert.mock.calls[1][0];
      const thirdPayload = mockInsert.mock.calls[2][0];

      expect(firstPayload).toEqual(secondPayload);
      expect(secondPayload).toEqual(thirdPayload);
    });

    it('handles zero shopId gracefully', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue(undefined);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      await EntitlementsService.grantDefaultFreeTierForShop(0);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const payload = mockInsert.mock.calls[0][0];
      
      // All rows should have shop_id: 0
      payload.forEach((row: any) => {
        expect(row.shop_id).toBe(0);
      });
    });

    it('handles negative shopId gracefully', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue(undefined);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      await EntitlementsService.grantDefaultFreeTierForShop(-1);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const payload = mockInsert.mock.calls[0][0];
      
      // All rows should have shop_id: -1
      payload.forEach((row: any) => {
        expect(row.shop_id).toBe(-1);
      });
    });

    
    it('includes the exact number of default entitlements', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue(undefined);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      await EntitlementsService.grantDefaultFreeTierForShop(123);

      const payload = mockInsert.mock.calls[0][0];
      // CORRECTED: There are 6 default rows, not 5
      expect(payload.length).toBe(6);

      // Count module occurrences
      const moduleCounts: Record<string, number> = {};
      const flagCounts: Record<string, number> = {};
      
      payload.forEach((row: any) => {
        moduleCounts[row.module_key] = (moduleCounts[row.module_key] || 0) + 1;
        if (row.flag_key) {
          flagCounts[row.flag_key] = (flagCounts[row.flag_key] || 0) + 1;
        }
      });

      // Verify expected distribution
      expect(moduleCounts['core_dashboard']).toBe(3); // 3 rows: 1 module + 2 flags
      expect(moduleCounts['shopify_integration']).toBe(2); // 2 rows: 1 module + 1 flag
      expect(moduleCounts['specter_sdk_free']).toBe(1); // 1 row: module only
      
      // Verify flag counts
      expect(flagCounts['view_basic_sales']).toBe(1);
      expect(flagCounts['view_recent_orders_widget']).toBe(1);
      expect(flagCounts['use_shopify_sync']).toBe(1);
    });

        it('inserts all expected default entitlements with correct values', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue(undefined);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      await EntitlementsService.grantDefaultFreeTierForShop(123);

      const payload = mockInsert.mock.calls[0][0];
      
      // Verify all 6 exact rows
      expect(payload).toEqual([
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: null,
          source: 'free_tier_default',
        },
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: 'view_basic_sales',
          source: 'free_tier_default',
        },
        {
          shop_id: 123,
          module_key: 'core_dashboard',
          flag_key: 'view_recent_orders_widget',
          source: 'free_tier_default',
        },
        {
          shop_id: 123,
          module_key: 'shopify_integration',
          flag_key: null,
          source: 'free_tier_default',
        },
        {
          shop_id: 123,
          module_key: 'shopify_integration',
          flag_key: 'use_shopify_sync',
          source: 'free_tier_default',
        },
        {
          shop_id: 123,
          module_key: 'specter_sdk_free',
          flag_key: null,
          source: 'free_tier_default',
        },
      ]);
    });

    it('does not modify the default bundle data structure', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockOnConflict = jest.fn().mockReturnThis();
      const mockIgnore = jest.fn().mockResolvedValue(undefined);

      mockedDb.mockImplementation((table: string) => {
        if (table === 'shop_module_entitlements') {
          return {
            insert: mockInsert,
            onConflict: mockOnConflict,
            ignore: mockIgnore,
          };
        }
        return {};
      });

      await EntitlementsService.grantDefaultFreeTierForShop(123);

      const payload = mockInsert.mock.calls[0][0];
      
      // Verify all expected properties exist
      payload.forEach((row: any) => {
        expect(row).toHaveProperty('shop_id');
        expect(row).toHaveProperty('module_key');
        expect(row).toHaveProperty('flag_key');
        expect(row).toHaveProperty('source');
        expect(typeof row.shop_id).toBe('number');
        expect(typeof row.module_key).toBe('string');
        expect(row.source).toBe('free_tier_default');
      });
    });
  });
});