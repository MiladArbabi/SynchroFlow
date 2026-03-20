/**
 * SHOPIFY WEBHOOK CORE
 * ---------------------
 * Low-level webhook registration logic.
 *
 * Extracted to:
 * - remove orchestration coupling
 * - prevent circular imports
 * - isolate side-effect logic
 */
export async function registerShopifyWebhooks(
  shopDomain: string,
  accessToken: string
) {
  /**
   * WEBHOOK COVERAGE (CRITICAL)
   * ----------------------------
   * Must include ALL ingestion-relevant topics.
   * Missing topics = silent data gaps.
   */
  const topics = [
    // Orders
    'orders/create',
    'orders/paid',
    'orders/fulfilled',

    // Fulfillment lifecycle
    'fulfillments/create',
    'fulfillments/update',

    // Financials
    'refunds/create',

    // Inventory
    'inventory_levels/update',
    'inventory_items/update',

    // App lifecycle
    'app/uninstalled',
  ];

  for (const topic of topics) {
    await fetch(`https://${shopDomain}/admin/api/2024-01/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook: {
          topic,
          /**
           * WEBHOOK ENDPOINT (CRITICAL)
           * ----------------------------
           * Must EXACTLY match Express route:
           * app.use('/api/v1/shopify', ...)
           * router.post('/webhooks', ...)
           *
           * Final path:
           * /api/v1/shopify/webhooks
           */
          address: `${process.env.APP_BASE_URL}/api/v1/shopify/webhooks`,
          format: 'json',
        },
      }),
    });

    console.info('[SHOPIFY_WEBHOOK_REGISTERED]', { topic });
  }
}