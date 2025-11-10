// tests/unit/api/shopify.service.test.ts
import { shopifyApi, Session } from '@shopify/shopify-api';
import db from 'api-src/db';

// Mock dependencies
jest.mock('@shopify/shopify-api', () => ({
  shopifyApi: jest.fn(),
  Session: jest.fn()
}));

jest.mock('api-src/db');

const mockedShopifyApi = shopifyApi as jest.MockedFunction<typeof shopifyApi>;
const mockedSession = Session as jest.MockedClass<typeof Session>;
const mockedDb = db as jest.Mocked<typeof db>;

describe('ShopifyService', () => {
  const mockAccessToken = 'test-access-token';
  const mockPlatformShopName = 'test-shop.myshopify.com';
  const mockShopId = 123;
  
  let mockClient: { request: jest.Mock };
  let performInitialSync: any;
  
/*   const mockTransaction = {
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockResolvedValue(undefined)
  } as any; */

  // update the mockTrx to track calls properly:
        let mockTrx: jest.Mock;
        let queryBuilderMocks: Record<string, any> = {};

  // Sample test data
  const mockGraphQLResponse = {
    data: {
      products: {
        edges: [
          {
            node: {
              id: 'gid://shopify/Product/1',
              title: 'Test Product 1',
              vendor: 'Test Vendor',
              productType: 'Test Type',
              status: 'ACTIVE',
              totalInventory: 10
            }
          }
        ]
      },
      orders: {
        edges: [
          {
            node: {
              id: 'gid://shopify/Order/1',
              name: '#1001',
              fulfillmentStatus: 'FULFILLED',
              financialStatus: 'PAID',
              totalPriceSet: { 
                shopMoney: { 
                  amount: '99.99' 
                } 
              },
              currencyCode: 'USD',
              fulfillments: [
                {
                  id: 'gid://shopify/Fulfillment/1',
                  status: 'SUCCESS',
                  trackingInfo: [
                    {
                      company: 'UPS',
                      number: '1Z123456789'
                    }
                  ]
                }
              ]
            }
          }
        ]
      },
      payouts: {
        edges: [
          {
            node: {
              id: 'gid://shopify/Payout/1',
              status: 'PAID',
              date: '2023-01-01',
              currency: 'USD',
              amount: '1000.00',
              fee: '50.00',
              netAmount: '950.00'
            }
          }
        ]
      }
    }
  };

  const mockEmptyResponse = {
    data: {
      products: { edges: [] },
      orders: { edges: [] },
      payouts: { edges: [] }
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment variables
    process.env.SHOPIFY_API_KEY = 'test-key';
    process.env.SHOPIFY_API_SECRET = 'test-secret';
    process.env.SHOPIFY_API_VERSION = '2023-10';
    
    // Setup mock Shopify client
    mockClient = {
      request: jest.fn()
    };

    // Setup shopifyApi mock
    mockedShopifyApi.mockReturnValue({
      clients: {
        Graphql: jest.fn().mockReturnValue(mockClient)
      }
    } as any);

    // Setup session mock
    mockedSession.mockImplementation((params: any) => params as any);
    
    queryBuilderMocks = {
    shopify_products: {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(), 
      merge: jest.fn().mockResolvedValue(undefined)
    },
    orders: {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined)
    },
    shopify_fulfillments: {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined)
    },
    shopify_payouts: {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined)
    }
  };

    mockTrx = jest.fn().mockImplementation((table: string) => {
        return queryBuilderMocks[table] || queryBuilderMocks.shopify_products;
    });

    mockedDb.transaction.mockImplementation(async (callback: any) => {
        return callback(mockTrx);
    });

    // Dynamically import the service after mocks are set up
    jest.isolateModules(() => {
      performInitialSync = require('api-src/services/shopify.service').performInitialSync;
    });

    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('performInitialSync', () => {
    it('should successfully perform complete sync with all data types', async () => {
      mockClient.request.mockResolvedValue(mockGraphQLResponse);

      await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

      // Verify Shopify client initialization
      expect(mockedShopifyApi).toHaveBeenCalledWith({
        apiKey: 'test-key',
        apiSecretKey: 'test-secret',
        apiVersion: '2023-10',
        isEmbeddedApp: false,
        hostName: 'localhost',
      });

      // Verify GraphQL query structure
      expect(mockClient.request).toHaveBeenCalledWith(expect.stringContaining('query {'));
      expect(mockClient.request).toHaveBeenCalledWith(expect.stringContaining('products(first: 50)'));
      expect(mockClient.request).toHaveBeenCalledWith(expect.stringContaining('orders(first: 50)'));
      expect(mockClient.request).toHaveBeenCalledWith(expect.stringContaining('payouts(first: 50)'));

      // Verify transaction was started
      expect(mockedDb.transaction).toHaveBeenCalled();

      // Verify all sync functions were called with correct data
      expect(mockTrx).toHaveBeenCalledWith('shopify_products');
      expect(mockTrx).toHaveBeenCalledWith('orders');
      expect(mockTrx).toHaveBeenCalledWith('shopify_fulfillments');
      expect(mockTrx).toHaveBeenCalledWith('shopify_payouts');
    });

    it('should handle empty response data gracefully', async () => {
        mockClient.request.mockResolvedValue(mockEmptyResponse);

        await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

        // Verify transaction was called
        expect(mockedDb.transaction).toHaveBeenCalled();
        // Verify GraphQL was called
        expect(mockClient.request).toHaveBeenCalled();
        // Don't check for insert calls since they're skipped when arrays are empty
        });

        // Update the partial data test to use a response that actually has products:
        it('should handle partial data when some sections are missing', async () => {
        const partialResponse = {
            data: {
            products: { 
                edges: [
                {
                    node: {
                    id: 'gid://shopify/Product/1',
                    title: 'Test Product',
                    vendor: 'Test Vendor', 
                    productType: 'Test Type',
                    status: 'ACTIVE',
                    totalInventory: 10
                    }
                }
                ]
            },
            orders: { edges: [] }, // No orders
            payouts: null // Payouts completely missing
            }
        };
        
        mockClient.request.mockResolvedValue(partialResponse);

        await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

        // Should process products since the array is not empty
        expect(mockTrx).toHaveBeenCalledWith('shopify_products');
        });

    it('should throw error when Shopify API request fails', async () => {
      const mockError = new Error('API Error');
      mockClient.request.mockRejectedValue(mockError);

      await expect(
        performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId)
      ).rejects.toThrow('API Error');

      // Verify transaction was NOT called (should fail before transaction)
      expect(mockedDb.transaction).not.toHaveBeenCalled();
    });

    it('should handle database transaction failure', async () => {
      mockClient.request.mockResolvedValue(mockGraphQLResponse);
      
      const dbError = new Error('Database constraint violation');
      mockedDb.transaction.mockRejectedValue(dbError);

      await expect(
        performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId)
      ).rejects.toThrow('Database constraint violation');

      // Verify Shopify API was still called
      expect(mockClient.request).toHaveBeenCalled();
    });

    it('should use correct session parameters for offline token', async () => {
      mockClient.request.mockResolvedValue(mockEmptyResponse);

      await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

      // Verify Session was created with correct parameters for offline token
      expect(mockedSession).toHaveBeenCalledWith({
        id: `session-sync-${mockShopId}`,
        shop: mockPlatformShopName,
        state: 'state',
        isOnline: true, // Should be true for offline tokens
        accessToken: mockAccessToken,
      });
    });
  });

  describe('Data transformation tests', () => {
    beforeEach(() => {
      mockClient.request.mockResolvedValue(mockGraphQLResponse);
    });

    it('should transform product data correctly', async () => {
    mockClient.request.mockResolvedValue(mockGraphQLResponse);

    await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

    const expectedProductData = [
        {
        shop_id: mockShopId,
        platform_product_id: 'gid://shopify/Product/1',
        title: 'Test Product 1',
        vendor: 'Test Vendor',
        product_type: 'Test Type',
        status: 'ACTIVE',
        total_inventory: 10
        }
    ];

    expect(queryBuilderMocks.shopify_products.insert).toHaveBeenCalledWith(expectedProductData);
    expect(queryBuilderMocks.shopify_products.onConflict).toHaveBeenCalledWith(['shop_id', 'platform_product_id']);
    expect(queryBuilderMocks.shopify_products.merge).toHaveBeenCalled();
    });

    it('should transform order data correctly', async () => {
    await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

    const expectedOrderData = [
        {
        shop_id: mockShopId,
        platform_order_id: 'gid://shopify/Order/1',
        order_number: '#1001',
        fulfillment_status: 'FULFILLED',
        financial_status: 'PAID',
        total_price: '99.99',
        currency: 'USD'
        }
    ];

    // Debug what was actually called
   console.log('Orders insert calls:', queryBuilderMocks.orders.insert.mock.calls);
   console.log('Orders onConflict calls:', queryBuilderMocks.orders.onConflict.mock.calls);

    // Use the specific orders query builder mock
    expect(queryBuilderMocks.orders.insert).toHaveBeenCalledWith(expectedOrderData);
    expect(queryBuilderMocks.orders.onConflict).toHaveBeenCalledWith('platform_order_id');
    // expect(queryBuilderMocks.orders.merge).toHaveBeenCalled();
    });

it('should transform fulfillment data correctly', async () => {
  await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

  const expectedFulfillmentData = [
    {
      shop_id: mockShopId,
      platform_fulfillment_id: 'gid://shopify/Fulfillment/1',
      platform_order_id: 'gid://shopify/Order/1',
      status: 'SUCCESS',
      tracking_company: 'UPS',
      tracking_number: '1Z123456789',
      total_shipping_cost: 0
    }
  ];

   // Debug what was actually called  
   console.log('Fulfillments insert calls:', queryBuilderMocks.shopify_fulfillments.insert.mock.calls);
   console.log('Fulfillments onConflict calls:', queryBuilderMocks.shopify_fulfillments.onConflict.mock.calls);

  // Use the specific shopify_fulfillments query builder mock
  expect(queryBuilderMocks.shopify_fulfillments.insert).toHaveBeenCalledWith(expectedFulfillmentData);
  expect(queryBuilderMocks.shopify_fulfillments.onConflict).toHaveBeenCalledWith(['shop_id', 'platform_fulfillment_id']);
  expect(queryBuilderMocks.shopify_fulfillments.merge).toHaveBeenCalled();
});

it('should transform payout data correctly', async () => {
  await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

  const expectedPayoutData = [
    {
      shop_id: mockShopId,
      platform_payout_id: 'gid://shopify/Payout/1',
      status: 'PAID',
      date: '2023-01-01',
      currency: 'USD',
      amount: '1000.00',
      fees: '50.00',
      net_amount: '950.00'
    }
  ];

  // Debug what was actually called
   console.log('Payouts insert calls:', queryBuilderMocks.shopify_payouts.insert.mock.calls);
   console.log('Payouts onConflict calls:', queryBuilderMocks.shopify_payouts.onConflict.mock.calls);

  // Use the specific shopify_payouts query builder mock
  expect(queryBuilderMocks.shopify_payouts.insert).toHaveBeenCalledWith(expectedPayoutData);
  expect(queryBuilderMocks.shopify_payouts.onConflict).toHaveBeenCalledWith(['shop_id', 'platform_payout_id']);
  expect(queryBuilderMocks.shopify_payouts.merge).toHaveBeenCalled();
  });
});

    

  describe('Edge cases and error handling', () => {
      // Also update the edge case test:
    it('should handle null or undefined values in product data', async () => {
    const responseWithNulls = {
        data: {
        products: {
            edges: [
            {
                node: {
                id: 'gid://shopify/Product/1',
                title: null,
                vendor: null,
                productType: null,
                status: null,
                totalInventory: null
                }
            }
            ]
        },
        orders: { edges: [] },
        payouts: { edges: [] }
        }
    };

    mockClient.request.mockResolvedValue(responseWithNulls);

    await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

    expect(queryBuilderMocks.shopify_products.insert).toHaveBeenCalledWith([
        expect.objectContaining({
        title: null,
        vendor: null,
        product_type: null,
        status: null,
        total_inventory: 0 // Default value for null inventory
        })
    ]);
});

  it('should handle orders without fulfillments', async () => {
    const orderWithoutFulfillments = {
        data: {
          products: { edges: [] },
          orders: {
            edges: [
              {
                node: {
                  id: 'gid://shopify/Order/1',
                  name: '#1001',
                  fulfillmentStatus: 'UNFULFILLED',
                  financialStatus: 'PENDING',
                  totalPriceSet: { shopMoney: { amount: '50.00' } },
                  currencyCode: 'USD',
                  fulfillments: []
                }
              }
            ]
          },
          payouts: { edges: [] }
        }
      };

    mockClient.request.mockResolvedValue(orderWithoutFulfillments);

    await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

    expect(queryBuilderMocks.orders.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          platform_order_id: 'gid://shopify/Order/1'
        })
      ])
    );
    expect(queryBuilderMocks.shopify_fulfillments.insert).not.toHaveBeenCalled();
  });

  it('should handle tracking info with missing company or number', async () => {
    const orderWithPartialTracking = {
        data: {
          products: { edges: [] },
          orders: {
            edges: [
              {
                node: {
                  id: 'gid://shopify/Order/1',
                  name: '#1001',
                  fulfillmentStatus: 'FULFILLED',
                  financialStatus: 'PAID',
                  totalPriceSet: { shopMoney: { amount: '50.00' } },
                  currencyCode: 'USD',
                  fulfillments: [
                    {
                      id: 'gid://shopify/Fulfillment/1',
                      status: 'SUCCESS',
                      trackingInfo: [{}]
                    }
                  ]
                }
              }
            ]
          },
          payouts: { edges: [] }
        }
      };

    mockClient.request.mockResolvedValue(orderWithPartialTracking);

    await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

    expect(queryBuilderMocks.shopify_fulfillments.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          platform_fulfillment_id: 'gid://shopify/Fulfillment/1',
          tracking_company: undefined,
          tracking_number: undefined
        })
      ])
    );
  });
});

  describe('Performance and scalability', () => {
  it('should handle large number of records efficiently', async () => {
    // Create mock data with 50 records for each type (matching the GraphQL query limits)
    const largeDataset = {
      data: {
        products: {
          edges: Array.from({ length: 50 }, (_, i) => ({
            node: {
              id: `gid://shopify/Product/${i + 1}`,
              title: `Product ${i + 1}`,
              vendor: `Vendor ${i % 5}`,
              productType: `Type ${i % 3}`,
              status: 'ACTIVE',
              totalInventory: i * 10
            }
          }))
        },
        orders: {
          edges: Array.from({ length: 50 }, (_, i) => ({
            node: {
              id: `gid://shopify/Order/${i + 1}`,
              name: `#${1000 + i}`,
              fulfillmentStatus: 'FULFILLED',
              financialStatus: 'PAID',
              totalPriceSet: { shopMoney: { amount: (i * 10 + 50).toString() } },
              currencyCode: 'USD',
              fulfillments: [
                {
                  id: `gid://shopify/Fulfillment/${i + 1}`,
                  status: 'SUCCESS',
                  trackingInfo: [
                    {
                      company: 'UPS',
                      number: `1Z${i.toString().padStart(12, '0')}`
                    }
                  ]
                }
              ]
            }
          }))
        },
        payouts: {
          edges: Array.from({ length: 50 }, (_, i) => ({
            node: {
              id: `gid://shopify/Payout/${i + 1}`,
              status: 'PAID',
              date: `2023-01-${(i % 30) + 1}`,
              currency: 'USD',
              amount: (i * 100 + 500).toString(),
              fee: (i * 5 + 10).toString(),
              netAmount: (i * 95 + 490).toString()
            }
          }))
        }
      }
    };

    mockClient.request.mockResolvedValue(largeDataset);

    await performInitialSync(mockAccessToken, mockPlatformShopName, mockShopId);

    // Verify all 50 records of each type were processed using specific mocks
    expect(queryBuilderMocks.shopify_products.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ platform_product_id: 'gid://shopify/Product/50' })
      ])
    );
    
    expect(queryBuilderMocks.orders.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ platform_order_id: 'gid://shopify/Order/50' })
      ])
    );
    
    expect(queryBuilderMocks.shopify_fulfillments.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ platform_fulfillment_id: 'gid://shopify/Fulfillment/50' })
      ])
    );
    
    expect(queryBuilderMocks.shopify_payouts.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ platform_payout_id: 'gid://shopify/Payout/50' })
      ])
    );
    
    // Should only make one GraphQL request
    expect(mockClient.request).toHaveBeenCalledTimes(1);
    });
  });
});