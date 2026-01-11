// Shopify Webhook Verification
// ----------------------------
//
// Shopify computes the HMAC over the exact raw HTTP body bytes.
// JSON re-serialization WILL invalidate the signature.
//
// HARD REQUIREMENT:
// - express.json({ verify }) MUST populate req.rawBody
// - express.raw() MUST NOT be used globally (breaks other routes)
//
// Reference:
// https://shopify.dev/docs/apps/webhooks/configuration/https

import { createWebhookVerifier } from 'api-src/api/webhooks/verifyWebhook';

export const verifyShopifySignature = createWebhookVerifier({
  header: 'x-shopify-hmac-sha256',
  secretEnv: 'SHOPIFY_WEBHOOK_SECRET',
  digest: 'base64',
  compare: (signature, expected) => signature === expected,
});