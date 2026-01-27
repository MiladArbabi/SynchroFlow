// Generic Webhook Verification Factory
// ===================================
//
// PURPOSE
// -------
// Provides a single, auditable, transport-layer mechanism for verifying
// third-party webhooks using HMAC-SHA256 over the *raw request body*.
//
// This abstraction exists to:
// - Eliminate duplicated crypto logic
// - Guarantee fail-closed behavior across all integrations
// - Make verification rules explicit and testable
//
// CONTRACT
// --------
// - MUST run before any domain logic or ledger writes
// - MUST receive req.rawBody as a Buffer
// - MUST NOT mutate request body
// - MUST NOT touch persistence, queues, or services
//
// SECURITY MODEL
// --------------
// - Secrets are read exclusively from environment variables
// - Signature mismatch always returns 400
// - Missing secret returns 500 (misconfiguration)
// - Missing raw body returns 400 (misconfigured middleware)
//
// EXTENSIBILITY
// -------------
// New webhooks should ONLY configure:
// - signature header name
// - secret env variable
// - digest encoding
// - comparison strategy
//
// No custom verification logic should be written outside this file.

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

type VerifyConfig = {
  header: string;
  secretEnv: string;
  digest: 'hex' | 'base64';
  compare: (signature: string, expected: string) => boolean;
};

export function createWebhookVerifier(config: VerifyConfig) {
  return function verifyWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const secret = process.env[config.secretEnv];
    if (!secret) {
      return res.status(500).json({
        error: `Webhook secret not configured: ${config.secretEnv}`,
      });
    }

    const signature = req.headers[config.header] as string | undefined;
    if (!signature) {
      return res.status(400).json({
        error: `Missing webhook signature header: ${config.header}`,
      });
    }

        const rawBody = (req as any).rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      return res.status(400).json({
        error: 'Missing raw request body',
      });
    }

    // ─────────────────────────────────────────────
    // DEBUG (TEMPORARY): Raw body inspection
    // Purpose: Verify exact byte sequence used for HMAC
    // REMOVE after verification succeeds
    // ─────────────────────────────────────────────
    console.log('[WEBHOOK VERIFY] rawBody utf8:', rawBody.toString('utf8'));
    console.log('[WEBHOOK VERIFY] rawBody hex :', rawBody.toString('hex'));
    console.log('[WEBHOOK VERIFY] signature  :', signature);
    // ─────────────────────────────────────────────

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest(config.digest);

    // Optional but useful while debugging
    console.log('[WEBHOOK VERIFY] expected   :', expected);

    if (!config.compare(signature, expected)) {
      return res.status(400).json({
        error: 'Invalid webhook signature',
      });
    }

    return next();
  };
}