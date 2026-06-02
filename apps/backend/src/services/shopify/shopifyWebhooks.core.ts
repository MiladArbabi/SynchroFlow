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

    // Catalog — automatic product ingestion on create/update
    // Eliminates manual resync requirement for new Shopify products
    'products/create',
    'products/update',

    // App lifecycle
    'app/uninstalled',
  ];

  /**
   * APP_BASE_URL GUARD (CRITICAL)
   * ------------------------------
   * Without this, webhook address becomes "undefined/api/v1/..."
   * causing Shopify to reject all registrations silently.
   */
  if (!process.env.APP_BASE_URL) {
    console.error('[SHOPIFY_WEBHOOK_REGISTRATION_FATAL] APP_BASE_URL is not set — webhooks will not be registered');
    throw new Error('[SHOPIFY_WEBHOOK_REGISTRATION_FATAL] APP_BASE_URL missing');
  }

  for (const topic of topics) {
    const res = await fetch(`https://${shopDomain}/admin/api/2024-01/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address: `${process.env.APP_BASE_URL}/api/v1/shopify/webhooks`,
          format: 'json',
        },
      }),
    });

    if (res.ok) {
      console.info('[SHOPIFY_WEBHOOK_REGISTERED]', { topic });
    } else if (res.status === 422) {
      // Already registered — not an error
      console.info('[SHOPIFY_WEBHOOK_ALREADY_REGISTERED]', { topic, status: res.status });
    } else {
      const body = await res.text();
      console.error('[SHOPIFY_WEBHOOK_REGISTRATION_FAILED]', { topic, status: res.status, body });
    }
  }
}