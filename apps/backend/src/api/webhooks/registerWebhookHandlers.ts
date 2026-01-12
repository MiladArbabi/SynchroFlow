import { WebhookRouter } from './webhookRouter';
import { handleAppUninstalled } from 'api-src/api/shopify/handlers';
import { handleInvoicePaid } from 'api-src/api/billing/handlers';

export function registerWebhookHandlers() {
  WebhookRouter.register({
    integration: 'shopify',
    eventType: 'app/uninstalled',
    handle: handleAppUninstalled,
  });

  WebhookRouter.register({
    integration: 'stripe',
    eventType: 'invoice.paid',
    handle: handleInvoicePaid,
  });
}