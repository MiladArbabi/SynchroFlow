// apps/backend/src/api/shopify/shopify.verify.middleware.ts
//
// Shopify webhook verification middleware
//
// HARD RULES:
// - Transport-level only
// - Fail-closed
// - Uses raw request body
// - No ledger writes here
// - No domain logic

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const SHOPIFY_HMAC_HEADER = 'x-shopify-hmac-sha256';

// Replace with that
export function verifyShopifySignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Shopify webhook secret not configured' });
  }

  const signature = req.headers['x-shopify-hmac-sha256'] as string | undefined;
  if (!signature) {
    return res.status(400).json({ error: 'Missing Shopify HMAC header' });
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Missing raw request body' });
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  if (signature !== expected) {
    return res.status(400).json({ error: 'Invalid Shopify HMAC signature' });
  }

  return next();
}
