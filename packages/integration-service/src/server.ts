// packages/integration-service/src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import db from './db';
import { publishToQueue } from './queue';

const app = express();
const port = process.env.INTEGRATION_PORT || 3001;

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

    // --- DEBUG LOGS ---
    console.log('[DEBUG] Received Signature:', hmacHeader);
    console.log('[DEBUG] Generated Signature:', generatedHash);
    // --- END DEBUG LOGS ---

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

app.get('/health', (req: Request, res: Response) => {
  res.status(200).send('Integration service is running!');
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
      // Save the raw payload to our staging table
      const [stagedEvent] = await db('staged_events').insert({
        shop_id: Number(shop_id),
        source_platform: 'shopify',
        event_type: 'orders/create',
        raw_payload: payload,
      }).returning('id');

      // Publish the ID of the staged event to the queue
      await publishToQueue('events', JSON.stringify({ staged_event_id: stagedEvent.id }));

      console.log('Received and verified Shopify webhook for order:', payload.order_id);
      res.status(200).send('Webhook received');
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).send('Error processing webhook');
    }
  }
);

// This conditional allows us to import 'app' in our tests without starting the server.
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
      console.log(`[integration-service]: Server is running at http://localhost:${port}`);
    });
  }

export default app; // Export the app for testing