import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

/**
 * SHOPIFY CLIENT FACTORY
 * ----------------------------------------------
 * Centralizes Shopify API initialization.
 *
 * NOTE (SCOPE-02): this scopes array is NOT authoritative and is NOT
 * enforced by the SDK — @shopify/shopify-api only reads config.scopes
 * inside shopify.auth.begin(), which this codebase never calls (OAuth
 * URLs are built manually in integration.controller.ts). The real
 * source of truth is shopify.app.toml [access_scopes], which MUST
 * match the scope arrays in integration.controller.ts's initiateOAuth
 * and handleShopifyInstall. This list is kept only as a description
 * of scopes this client's queries actually rely on.
 */

const REQUIRED_SCOPES = [
  'read_orders',
  'read_customers',
  'read_products',
  'read_inventory',
  'write_inventory',          // stow cascade sync
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