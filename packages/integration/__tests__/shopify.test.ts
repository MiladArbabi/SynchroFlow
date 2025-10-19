// packages/integration-service/__tests__/shopify.test.ts
import { fetchRecentOrders } from '../src/clients/shopify';
import { shopifyApi } from '@shopify/shopify-api';

// Create a typed mock for the GraphQL client that we can control in tests
const mockShopifyGraphQLClient = {
  request: jest.fn(),
};

// Mock the entire shopify-api library
jest.mock('@shopify/shopify-api', () => ({
  ...jest.requireActual('@shopify/shopify-api'), // Import and retain actual constants
  // Configure the mock immediately
  shopifyApi: jest.fn().mockReturnValue({
    clients: {
      Graphql: jest.fn().mockImplementation(() => mockShopifyGraphQLClient),
    },
  }),
}));

describe('Shopify API Client', () => {

  beforeEach(() => {
    // Now we only need to clear the mock's call history, not re-configure it
    mockShopifyGraphQLClient.request.mockClear();
  });

  it('should construct a GraphQL query to fetch recent orders', async () => {
    // 1. SETUP
    const shop = 'test-shop.myshopify.com';
    const accessToken = 'test-access-token';
    
    // Mock the API response from Shopify
    mockShopifyGraphQLClient.request.mockResolvedValue({
      data: { orders: { edges: [{ node: { id: 'gid://shopify/Order/123' } }] } },
    });

    // 2. EXECUTION
    await fetchRecentOrders(shop, accessToken);

    // 3. ASSERTION
    // Check that our function called the Shopify client with a GraphQL query
    // that includes 'first: 50' and a query for orders created after a certain date.
    expect(mockShopifyGraphQLClient.request).toHaveBeenCalledWith(
      expect.stringMatching(/first: 50.*created_at:>/s)
    );
  });
});