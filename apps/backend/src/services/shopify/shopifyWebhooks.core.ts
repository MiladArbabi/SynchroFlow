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
  const topics = [
    'fulfillments/create',
    'fulfillments/update',
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
          address: `${process.env.APP_BASE_URL}/api/shopify/webhook`,
          format: 'json',
        },
      }),
    });

    console.info('[SHOPIFY_WEBHOOK_REGISTERED]', { topic });
  }
}