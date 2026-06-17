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

  // GraphQL WebhookSubscriptionTopic enum uses TOPIC_LIKE_THIS — map from REST-style topic strings
  const GRAPHQL_TOPIC_MAP: Record<string, string> = {
    'orders/create': 'ORDERS_CREATE',
    'orders/paid': 'ORDERS_PAID',
    'orders/fulfilled': 'ORDERS_FULFILLED',
    'fulfillments/create': 'FULFILLMENTS_CREATE',
    'fulfillments/update': 'FULFILLMENTS_UPDATE',
    'refunds/create': 'REFUNDS_CREATE',
    'inventory_levels/update': 'INVENTORY_LEVELS_UPDATE',
    'inventory_items/update': 'INVENTORY_ITEMS_UPDATE',
    'products/create': 'PRODUCTS_CREATE',
    'products/update': 'PRODUCTS_UPDATE',
    'app/uninstalled': 'APP_UNINSTALLED',
  };

  const callbackUrl = `${process.env.APP_BASE_URL}/api/v1/shopify/webhooks`;

  for (const topic of topics) {
    const graphqlTopic = GRAPHQL_TOPIC_MAP[topic];
    if (!graphqlTopic) {
      console.error('[SHOPIFY_WEBHOOK_REGISTRATION_FAILED]', { topic, reason: 'NO_GRAPHQL_TOPIC_MAPPING' });
      continue;
    }

    const res = await fetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          mutation {
            webhookSubscriptionCreate(
              topic: ${graphqlTopic}
              webhookSubscription: {
                callbackUrl: "${callbackUrl}"
                format: JSON
              }
            ) {
              webhookSubscription { id }
              userErrors { field message }
            }
          }
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[SHOPIFY_WEBHOOK_REGISTRATION_FAILED]', { topic, status: res.status, body });
      continue;
    }

    const json: any = await res.json();
    const userErrors = json?.data?.webhookSubscriptionCreate?.userErrors ?? [];

    if (userErrors.length === 0) {
      console.info('[SHOPIFY_WEBHOOK_REGISTERED]', { topic });
    } else if (userErrors.some((e: any) => /already|taken/i.test(e.message))) {
      console.info('[SHOPIFY_WEBHOOK_ALREADY_REGISTERED]', { topic, userErrors });
    } else {
      console.error('[SHOPIFY_WEBHOOK_REGISTRATION_FAILED]', { topic, userErrors });
    }
  }
}