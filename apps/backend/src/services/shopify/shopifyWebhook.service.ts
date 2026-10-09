import { registerShopifyWebhooks } from './shopifyWebhooks.core.js';
import { resolveShopifyAdminCredentialForConsumer } from './shopifyAdminCredentialConsumer.service.js';

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
  const credential = await resolveShopifyAdminCredentialForConsumer({
    shopId,
    now: new Date(),
  });
  if (credential.kind !== 'READY') {
    throw new Error(`SHOPIFY_CREDENTIAL_${credential.kind}`);
  }

  try {
    await registerShopifyWebhooks(
      credential.shopDomain,
      credential.accessToken
    );

    console.info('[SHOPIFY_WEBHOOKS_REGISTERED]', { shopId });
  } catch (err) {
    console.error('[SHOPIFY_WEBHOOK_REGISTRATION_FAILED_NON_FATAL]', {
      shopId,
      error: (err as Error).message,
    });
  }
};
