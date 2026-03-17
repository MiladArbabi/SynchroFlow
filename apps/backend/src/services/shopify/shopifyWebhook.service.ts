import db from '@lasyncro/backend-core/db.js';
import { registerShopifyWebhooks } from './shopifyWebhooks.core.js';

/**
 * SHOPIFY WEBHOOK REGISTRATION SERVICE
 * ------------------------------------
 * Isolates webhook side-effects from sync flow.
 *
 * Guarantees:
 * - retry-safe invocation
 * - testable in isolation
 * - no coupling to ingestion success
 */

export const registerWebhooksForShop = async (shopId: number) => {
  const installationRow = await db('shopify_app_installations')
    .where({ shop_id: shopId })
    .select('shop_domain', 'access_token')
    .first();

  if (!installationRow?.shop_domain || !installationRow?.access_token) {
    throw new Error('[WEBHOOK_REGISTRATION_FAILED] Missing shop domain or token');
  }

  try {
    await registerShopifyWebhooks(
      installationRow.shop_domain,
      installationRow.access_token
    );

    console.info('[SHOPIFY_WEBHOOKS_REGISTERED]', { shopId });
  } catch (err) {
    console.error('[SHOPIFY_WEBHOOK_REGISTRATION_FAILED_NON_FATAL]', {
      shopId,
      error: (err as Error).message,
    });
  }
};