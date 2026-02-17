// Stripe Webhook Verification
// ---------------------------
//
// Stripe signs payloads using HMAC-SHA256 over the raw request body,
// but includes metadata in the signature header.
//
// Stripe's format allows multiple signatures (v1, v0, etc), so
// verification checks whether the computed digest is INCLUDED
// rather than strictly equal.
//
// Reference:
// https://stripe.com/docs/webhooks/signatures

import { createWebhookVerifier } from "../../api/webhooks/verifyWebhook.js";


export const verifyStripeSignature = createWebhookVerifier({
  header: 'stripe-signature',
  secretEnv: 'STRIPE_WEBHOOK_SECRET',
  digest: 'hex',
  compare: (signature, expected) => signature.includes(expected),
});