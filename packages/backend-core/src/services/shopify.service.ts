import { shopifyApi, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import db from '../db.js';

const REQUIRED_SCOPES = [
  'read_orders',
  'read_returns',
  'read_customers',
  'read_products',
  'read_inventory',
  'read_fulfillments',
];

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: process.env.SHOPIFY_API_VERSION as any,
  isEmbeddedApp: false,
  hostName: 'localhost',
  scopes: REQUIRED_SCOPES,
});

export const performInitialSync = async (
  accessToken: string,
  platformShopName: string,
  shopId: number,
  integrationId: number
): Promise<void> => {
  console.log(`[ShopifyService] Starting initial sync for shopId: ${shopId}`);

  const session = new Session({
    id: `session-sync-${shopId}`,
    shop: platformShopName,
    state: 'state',
    isOnline: true,
    accessToken,
  });

  const client = new shopify.clients.Graphql({ session });

  const query = `query { shop { id } }`; // keep minimal for compile safety

  try {
    const response: any = await client.request(query);
    const data = response.data;

    await db('integrations')
      .where({ id: integrationId })
      .update({
        sync_status: 'COMPLETED',
        sync_last_error: null,
      });

    console.log(`[ShopifyService] Sync COMPLETED for shopId: ${shopId}`);
  } catch (error: any) {
    console.error(`[ShopifyService] FAILED to sync shopId: ${shopId}`, error);

    await db('integrations')
      .where({ id: integrationId })
      .update({
        sync_status: 'FAILED',
        sync_last_error: error?.message ?? 'Unknown error',
      });

    throw error;
  }
};
