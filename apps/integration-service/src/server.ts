// packages/integration-service/src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import db from './db';
import { publishToQueue } from './queue';
import { fetchRecentOrders } from './clients/shopify';
import { mapShopifyOrderToCanonical } from './mappers/canonical-commerce-mapper';

const app = express();
const port = process.env.INTEGRATION_PORT || 3001;

// Simple PCD-safe customer hashing for CanonicalOrder mapping in FT0
const hashCustomerId = (shopId: number, rawCustomerId: string): string => {
  return crypto
    .createHash('sha256')
    .update(`${shopId}:${rawCustomerId}`)
    .digest('hex');
};

// --- Shopify HMAC Verification Middleware ---
// IMPORTANT: This middleware needs to run BEFORE express.json() for the webhook route,
// because it needs the raw, unparsed request body to compute the signature.
const verifyShopifyWebhook = (req: Request, res: Response, next: NextFunction) => {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  // Use the rawBody we save from the verify function, not the parsed body
  const body = (req as any).rawBody;
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();

  if (!hmacHeader || !secret) {
    return res.status(401).send('Unauthorized: Missing signature or secret.');
  }

  try {
    const generatedHash = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('base64');

    const trusted = Buffer.from(hmacHeader, 'base64');
    const untrusted = Buffer.from(generatedHash, 'base64');

    if (crypto.timingSafeEqual(trusted, untrusted)) {
      next(); // Signature is valid
    } else {
      // Signatures don't match
      res.status(401).send('Unauthorized: Invalid signature.');
    }
  } catch (error) {
    // Catch any errors during comparison (e.g., invalid Base64 format)
    res.status(401).send('Unauthorized: Invalid signature format.');
  }
};

app.get('/health', (req, res) => {
  //console.log('[DEBUG] Health check hit. Responding OK.');
  res.status(200).send({ status: 'ok' });
});

// --- Webhook Ingestion Route ---
app.post(
  '/ingest/shopify/:shop_id/orders/create',
  // Use express.json with a custom verify function
  express.json({
    verify: (req: Request, res: Response, buf: Buffer) => {
      // Save the raw buffer to the request object before it's parsed
      (req as any).rawBody = buf;
    }
  }),
  verifyShopifyWebhook,
  async (req: Request, res: Response) => {
    // The signature is valid, and the body is already parsed JSON.
    const payload = req.body;
    const { shop_id } = req.params;

    try {
      /**
       * CANONICAL INGESTION CONTRACT
       * ----------------------------
       * - Append-only domain_events
       * - Idempotent via (shop_id, external_event_id)
       * - Worker consumes { domain_event_id } only
       */
      const [inserted] = await db('domain_events')
        .insert({
          shop_id: Number(shop_id),
          event_type: 'orders/create',
          event_payload: payload,
          event_time: new Date(payload.created_at),
          event_version: 1,
          external_event_id: req.get('X-Shopify-Webhook-Id'),
        })
        .returning('id');

      await publishToQueue(
        'events',
        JSON.stringify({ domain_event_id: inserted.id }),
      );

      console.log('Received and verified Shopify webhook for order:', payload.order_id);
      res.status(200).send('Webhook received');
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).send('Error processing webhook');
    }
  }
);

// --- Integration Triggers ---
app.post('/integrations/shopify/start-trial-sync', express.json(), async (req: Request, res: Response) => {
  try {
    const { shopId, shop, accessToken, payload } = req.body;

    if (!shopId || !shop || !accessToken) {
      return res.status(400).json({ error: 'shopId, shop, and accessToken are required.' });
    }

    // 1. Fetch the recent orders from Shopify
    const orders = await fetchRecentOrders(shop, accessToken);

    // 2. Canonicalize & process each order through the pipeline

    // Import canonical mapper + simple hashing
    // (top of file, but adding here for diff clarity)
    const { mapShopifyOrderToCanonical } = await import('./mappers/canonical-commerce-mapper.js'); 
    const hashCustomerId = (shopId: number, rawCustomerId: string) =>
      `hashed:${shopId}:${rawCustomerId}`; // FT0 safe stub
    // 2. Process each order by pushing it into our pipeline (canonicalized)
    for (const order of orders) {
      const canonicalOrder = mapShopifyOrderToCanonical(order, {
        hashCustomerId,
      });

      /**
       * CANONICAL INGESTION CONTRACT
       * ----------------------------
       * - Append-only domain_events
       * - Idempotent via (shop_id, external_event_id)
       * - Worker consumes { domain_event_id } only
       */
      const [inserted] = await db('domain_events')
        .insert({
          shop_id: Number(shopId),
          event_type: 'orders/create',
          event_payload: payload,
          event_time: new Date(payload.created_at),
          event_version: 1,
          external_event_id: req.get('X-Shopify-Webhook-Id'),
        })
        .returning('id');

      await publishToQueue(
        'events',
        JSON.stringify({ domain_event_id: inserted.id }),
      );
    }

    console.log(`[trial-sync] Initiated sync for ${orders.length} orders for shop ${shopId}.`);
    // 202 Accepted is a great status code for starting a background job.
    res.status(202).json({ message: `Scoped trial sync initiated for ${orders.length} orders.` });

  } catch (error) {
    console.error('Error starting scoped trial sync:', error);
    res.status(500).json({ error: 'Failed to start trial sync.' });
  }
});

// This conditional allows us to import 'app' in our tests without starting the server.
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
      console.log(`[integration-service]: Server is running at http://localhost:${port}`);
    });
  }

export default app; // Export the app for testing