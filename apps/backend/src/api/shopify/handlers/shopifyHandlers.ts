// shopifyHandlers.ts
import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { handleAppUninstalled } from './handleAppUninstalled';

export async function onShopifyAppUninstalled(
  envelope: WebhookEnvelope
): Promise<void> {
  if (!envelope.shopDomain) {
    throw new Error('Missing shopDomain');
  }

  await handleAppUninstalled({
    shopDomain: envelope.shopDomain,
  });
}
