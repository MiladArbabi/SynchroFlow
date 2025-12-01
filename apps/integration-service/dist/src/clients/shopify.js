"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRecentOrders = fetchRecentOrders;
// packages/integration-service/src/clients/shopify.ts
const shopify_api_1 = require("@shopify/shopify-api");
require("@shopify/shopify-api/adapters/node");
// Initialize the Shopify API library context
const shopify = (0, shopify_api_1.shopifyApi)({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET_KEY, // The '!' asserts that this value is not undefined
    apiVersion: shopify_api_1.ApiVersion.October23, // Use a specific, stable API version
    isEmbeddedApp: false,
    hostName: 'localhost', // Or your app's host name
});
async function fetchRecentOrders(shop, accessToken) {
    // Create a new session for the GraphQL client
    const session = new shopify_api_1.Session({
        id: `session-for-${shop}`,
        shop,
        state: 'state',
        isOnline: true,
        accessToken,
    });
    // Create a GraphQL client from the session
    const client = new shopify.clients.Graphql({ session });
    // Calculate the date 30 days ago for the scoped trial
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateFilter = thirtyDaysAgo.toISOString();
    // Define the GraphQL query
    const query = `
    query {
      orders(first: 50, query: "created_at:>${dateFilter}") {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              email
            }
          }
        }
      }
    }
  `;
    // Make the API call
    try {
        const response = await client.request(query);
        return response.data;
    }
    catch (error) {
        console.error("Failed to fetch Shopify orders:", error);
        throw error;
    }
}
