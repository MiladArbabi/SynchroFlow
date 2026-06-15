// apps/backend/src/api/shopify/shopify.webhook.router.ts
//
// Shopify Webhook Router
//
// RESPONSIBILITIES:
// - Route Shopify webhooks by topic
// - Delegate execution to transport adapter
//
// NON-RESPONSIBILITIES:
// - No verification
// - No ledger writes
// - No domain logic

import { Router, Request, Response } from 'express';
import { shopifyWebhookHandler } from './shopify.webhook.js';

const router = Router();

/**
 * Shopify webhook dispatcher
 *
 * Shopify sends the topic in the `X-Shopify-Topic` header.
 */
router.post('/', async (req: Request, res: Response) => {
  const topic = req.headers['x-shopify-topic'] as string | undefined;

  if (!topic) {
    return res.status(400).json({ error: 'Missing X-Shopify-Topic header' });
  }

  switch (topic) {
    case 'app/uninstalled':
    case 'fulfillments/create':
    case 'fulfillments/update':

    case 'orders/create':
    case 'orders/paid':
      return shopifyWebhookHandler(req, res);
    case 'orders/fulfilled': // defensive
      return shopifyWebhookHandler(req, res);
    
    case 'refunds/create': 
      return shopifyWebhookHandler(req, res);
    case 'returns/requested':
      return shopifyWebhookHandler(req, res);

    case 'inventory_levels/update':
    case 'inventory_items/update':
      return shopifyWebhookHandler(req, res);

    case 'products/create':
    case 'products/update':
      return shopifyWebhookHandler(req, res);

    // Mandatory compliance webhooks (GDPR / privacy law)
    case 'customers/data_request':
    case 'customers/redact':
    case 'shop/redact':
      return res.status(200).json({ status: 'received' });

    default:
      return res.status(200).json({ status: 'ignored' });
  }
});

export default router;