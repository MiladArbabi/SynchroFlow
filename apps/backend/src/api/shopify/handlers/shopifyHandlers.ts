// shopifyHandlers.ts

import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { handleAppUninstalled } from './handleAppUninstalled.js';

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
