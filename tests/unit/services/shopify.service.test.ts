// tests/unit/services/shopify.service.test.ts
import db from 'api-src/db';
import { shopifyApi } from '@shopify/shopify-api';

// Mock Shopify API in-place, with an internal mockRequest exposed via a property
jest.mock('@shopify/shopify-api', () => {
  const mockRequest = jest.fn().mockResolvedValue({
    data: {
      products: {
        edges: [
          {
            node: {
              id: 'gid://shopify/Product/1',
              title: 'Test Product',
              vendor: 'Test Vendor',
              productType: 'Default',
              status: 'active',
              totalInventory: 5,
            },
          },
        ],
      },
      orders: {
        edges: [
          {
            node: {
              id: 'gid://shopify/Order/1',
              name: '#1001',
              totalPriceSet: {
                shopMoney: {
                  amount: '10.00',
                  currencyCode: 'USD',
                },
              },
              currencyCode: 'USD',
              createdAt: '2025-01-01T00:00:00Z',
              sourceName: 'web',
              displayFulfillmentStatus: 'FULFILLED',
              displayFinancialStatus: 'PAID',
              lineItems: {
                edges: [
                  {
                    node: {
                      id: 'gid://shopify/LineItem/1',
                      quantity: 1,
                      product: { id: 'gid://shopify/Product/1' },
                    },
                  },
                  {
                    node: {
                      id: 'gid://shopify/LineItem/2',
                      quantity: 2,
                      product: { id: 'gid://shopify/Product/1' },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      shop: {
        id: 'gid://shopify/Shop/1',
        name: 'Test Shop',
        email: 'owner@test.com',
        currencyCode: 'USD',
        timezoneOffset: '-05:00',
      },
    },
  });

  class GraphqlClient {
    request = mockRequest;
  }

  const mockShopifyApi = jest.fn(() => ({
    clients: {
      Graphql: GraphqlClient,
    },
  }));

  // Expose the internal request mock for assertions
  (mockShopifyApi as any).__mockRequest = mockRequest;

  return {
    shopifyApi: mockShopifyApi,
    ApiVersion: {
      October25: '2025-10',
    },
    Session: class {
      constructor(_: any) {}
    },
  };
});

jest.mock('api-src/db');

const mockedDb = db as unknown as jest.Mock & {
  transaction: jest.Mock;
};

describe('ShopifyService.performInitialSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // These env vars are read when the real service module initializes,
    // but our mock shopifyApi ignores them; still set for safety.
    process.env.SHOPIFY_API_KEY = 'test-key';
    process.env.SHOPIFY_API_SECRET = 'test-secret';
    process.env.SHOPIFY_API_VERSION = 'October25';

    const integrationsUpdates: any[] = [];

    const baseTableMock = {
      where: jest.fn().mockReturnThis(),
      update: jest.fn(),
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn(),
      first: jest.fn(),
    };

    (mockedDb as jest.Mock).mockImplementation((table: string) => {
      if (table === 'integrations') {
        return {
          where: jest.fn().mockReturnThis(),
          update: jest.fn((data: any) => {
            integrationsUpdates.push(data);
            return Promise.resolve();
          }),
        };
      }

      if (
        table === 'shopify_products' ||
        table === 'orders' ||
        table === 'order_line_items'
      ) {
        return {
          insert: jest.fn().mockReturnValue({
            onConflict: jest.fn().mockReturnValue({
              merge: jest.fn(),
            }),
          }),
        };
      }

      return baseTableMock;
    });

    (mockedDb as any).__integrationUpdates = integrationsUpdates;

    mockedDb.transaction = jest.fn(async (callback: any) => {
      const trx = (table: string) => {
        if (table === 'integrations') {
          return {
            where: jest.fn().mockReturnThis(),
            update: jest.fn(),
          };
        }

        if (
          table === 'shopify_products' ||
          table === 'orders' ||
          table === 'order_line_items'
        ) {
          return {
            insert: jest.fn().mockReturnValue({
              onConflict: jest.fn().mockReturnValue({
                merge: jest.fn(),
              }),
            }),
          };
        }

        return baseTableMock;
      };

      await callback(trx as any);
    });
  });

  it('updates integration sync_status and progress based on Shopify data', async () => {
    const { performInitialSync } = await import('api-src/services/shopify.service');

    await performInitialSync(
      'test-access-token',
      'test-shop.myshopify.com',
      1, // shopId
      42 // integrationId
    );

    const updates = (mockedDb as any).__integrationUpdates as any[];

    // First update: SYNCING_PRODUCTS with correct total progression
    expect(updates[0]).toMatchObject({
      sync_status: 'SYNCING_PRODUCTS',
      sync_last_error: null,
      sync_progress_current: 0,
      // 1 product + 1 order + 2 line items = 4
      sync_progress_total: 4,
    });

    // Final update: COMPLETED with no error
    expect(updates[updates.length - 1]).toMatchObject({
      sync_status: 'COMPLETED',
      sync_last_error: null,
    });

    // Sanity: Shopify GraphQL was called once
    const anyApi = shopifyApi as any;
    const mockRequest = anyApi.__mockRequest as jest.Mock;
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});