/**
 * Stripe Test Signature Helper
 * ----------------------------
 * Generates a deterministic Stripe-style signature for webhook tests.
 *
 * This mirrors (in simplified form) the production verification logic:
 * HMAC-SHA256 over the raw request body using STRIPE_WEBHOOK_SECRET.
 *
 * IMPORTANT:
 * - This is test-only
 * - This does NOT relax security
 * - Tests that do not provide a valid signature MUST fail
 */

/**
 * IMPORTANT TEST CONTRACT
 * -----------------------
 * Any test hitting /billing/stripe/webhook MUST:
 * 1. Send the raw request body (Buffer)
 * 2. Provide a valid stripe-signature header
 *
 * This mirrors production behavior exactly.
 * Tests that bypass this are invalid by definition.
 */

import crypto from 'crypto';

export function signStripePayload(
  rawBody: Buffer,
  secret: string
): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Minimal Stripe-like format (sufficient for our verifier)
  return `v1=${signature}`;
}