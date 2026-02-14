import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: process.env.SHOPIFY_API_VERSION as ApiVersion,
  isEmbeddedApp: false,
  hostName: 'localhost',
  scopes: [
    'read_orders',
    'read_returns',
    'read_customers',
    'read_products',
    'read_inventory',
    'read_fulfillments'
  ],
});

export function createShopifyGraphQLClient(
  accessToken: string,
  platformShopName: string,
  shopId: number
) {
  const session = new Session({
    id: `session-${shopId}`,
    shop: platformShopName,
    state: 'state',
    isOnline: true,
    accessToken,
  });

  return new shopify.clients.Graphql({ session });
}
