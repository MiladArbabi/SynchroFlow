import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

/**
 * SHOPIFY CLIENT FACTORY (SINGLE SOURCE OF TRUTH)
 * ----------------------------------------------
 * Centralizes Shopify API initialization.
 *
 * Guarantees:
 * - consistent scopes
 * - reusable client creation
 * - isolation from orchestration logic
 */

const REQUIRED_SCOPES = [
  'read_orders',
  'read_returns',
  'read_customers',
  'read_products',
  'read_inventory',
  'write_inventory',          // stow cascade sync — already added
  'read_inventory_shipments',
  'write_inventory_shipments',
  'read_inventory_transfers',
  'write_inventory_transfers',
  'read_fulfillments',

  /**
   * REQUIRED FOR EXECUTION (CRITICAL)
   * ---------------------------------
   * Enables:
   * - fulfillmentCreate mutation
   *
   * Without this:
   * - Shopify returns authorization error
   */
  'write_fulfillments',

  /**
   * REQUIRED FOR WMS FULFILLMENT WRITEBACK (WM-20)
   * -----------------------------------------------
   * fulfillmentOrders query + fulfillmentCreateV2 mutation
   * require merchant-managed fulfillment order scopes.
   * Without these, Shopify returns 'Access denied for fulfillmentOrders field.'
   */
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
];

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: process.env.SHOPIFY_API_VERSION as ApiVersion,
  isEmbeddedApp: false,
  hostName: 'localhost',
  scopes: REQUIRED_SCOPES,
});

export const createShopifyGraphQLClient = ({
  accessToken,
  platformShopName,
  shopId,
}: {
  accessToken: string;
  platformShopName: string;
  shopId: number;
}) => {
  const session = new Session({
    id: `session-sync-${shopId}`,
    shop: platformShopName,
    state: 'state',
    isOnline: true,
    accessToken,
  });

  return new shopify.clients.Graphql({ session });
};