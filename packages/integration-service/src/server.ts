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
  const body = req.body;
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

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
  '/ingest/shopify/orders/create',
  // Use express.raw to get the raw buffer body for HMAC verification
  express.raw({ type: 'application/json' }),
  verifyShopifyWebhook,
  async (req: Request, res: Response) => {
    // If we get here, the signature was valid.
    // We can now parse the JSON body from the raw buffer.
    const payload = JSON.parse(req.body.toString());

    try {
      // Save the raw payload to our staging table
      const [stagedEvent] = await db('staged_events').insert({
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