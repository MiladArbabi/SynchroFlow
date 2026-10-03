import { shopifyApi, ApiVersion, Session, LogSeverity } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { SHOPIFY_REQUIRED_SCOPES } from './shopifyScopes.js';

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

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: process.env.SHOPIFY_API_VERSION as ApiVersion,
  isEmbeddedApp: false,
  hostName: 'localhost',
  scopes: [...SHOPIFY_REQUIRED_SCOPES],
  logger: {
    level: LogSeverity.Warning,
  },
});

export const createShopifyGraphQLClient = ({
  accessToken,
  platformShopName,
  shopId,
  apiVersion,
}: {
  accessToken: string;
  platformShopName: string;
  shopId: number;
  // Optional SDK per-client override. Omitted → the configured
  // SHOPIFY_API_VERSION, exactly as before.
  apiVersion?: string;
}) => {
  const session = new Session({
    id: `session-sync-${shopId}`,
    shop: platformShopName,
    state: 'state',
    isOnline: true,
    accessToken,
  });

  return new shopify.clients.Graphql({
    session,
    apiVersion: apiVersion as ApiVersion | undefined,
  });
};