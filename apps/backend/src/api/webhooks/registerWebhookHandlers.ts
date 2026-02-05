import { WebhookRouter } from './webhookRouter';

// Shopify
import { onShopifyAppUninstalled } from 'api-src/api/shopify/handlers/appUninstalled.handler';
import { handleOrderFulfillment } from 'api-src/api/shopify/handlers/handleOrderFulfillment';

// Stripe
import { handleInvoicePaid } from '../billing/handlers';
import { handleRefundCreated } from '../shopify/handlers/handleRefundCreated';

/**
 * registerWebhookHandlers
 * ----------------------
 * Single authoritative webhook routing surface.
 *
 * Rules:
 * - Explicit registrations only
 * - No side-effect imports
 * - One (integration, eventType) → one handler
 */
export function registerWebhookHandlers() {
  // ─────────────────────────────────────────
  // Shopify lifecycle
  // ─────────────────────────────────────────

  WebhookRouter.register({
    integration: 'shopify',
    eventType: 'app/uninstalled',
    handle: onShopifyAppUninstalled,
  });

    // Fulfillment execution truth
  WebhookRouter.register({
    integration: 'shopify',
    eventType: 'fulfillments/create',
    handle: handleOrderFulfillment,
  });

  // Refunds (authoritative revenue regression)
  WebhookRouter.register({
    integration: 'shopify',
    eventType: 'refunds/create',
    handle: handleRefundCreated,
  });

  WebhookRouter.register({
    integration: 'shopify',
    eventType: 'fulfillments/update',
    handle: handleOrderFulfillment,
  });

  // Defensive legacy fallback
  WebhookRouter.register({
    integration: 'shopify',
    eventType: 'orders/fulfilled',
    handle: handleOrderFulfillment,
  });

  // ─────────────────────────────────────────
  // Stripe lifecycle
  // ─────────────────────────────────────────

  WebhookRouter.register({
    integration: 'stripe',
    eventType: 'invoice.paid',
    handle: handleInvoicePaid,
  });
}