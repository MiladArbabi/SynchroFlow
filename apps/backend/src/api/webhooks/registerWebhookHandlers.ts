import { WebhookRouter } from './webhookRouter';
import { onShopifyAppUninstalled } from 'api-src/api/shopify/handlers/appUninstalled.handler';
import { handleInvoicePaid } from '../billing/handlers';

export function registerWebhookHandlers() {
  WebhookRouter.register({
    integration: 'shopify',
    eventType: 'app/uninstalled',
    handle: onShopifyAppUninstalled, // ✅ correct
  });

  WebhookRouter.register({
    integration: 'stripe',
    eventType: 'invoice.paid',
    handle: handleInvoicePaid,
  });
}