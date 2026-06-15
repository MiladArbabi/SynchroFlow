import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * DUAL-SECRET SHOPIFY WEBHOOK VERIFICATION
 * -----------------------------------------
 * Shopify signs webhooks with different secrets depending on origin:
 * - Manually-created admin webhooks → SHOPIFY_WEBHOOK_SECRET
 * - App-registered webhooks (products/create, products/update, etc.) → SHOPIFY_API_SECRET
 *
 * Both are valid. We try SHOPIFY_WEBHOOK_SECRET first, then fall back
 * to SHOPIFY_API_SECRET. Fails closed if neither matches.
 */
export function verifyShopifySignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const adminSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const appSecret = process.env.SHOPIFY_API_SECRET;

  if (!adminSecret || !appSecret) {
    return res.status(500).json({ error: 'Shopify webhook secrets not configured' });
  }

  const rawSignature = req.headers['x-shopify-hmac-sha256'];
  const signature = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;

  if (!signature) {
    return res.status(400).json({ error: 'Missing x-shopify-hmac-sha256 header' });
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Missing raw request body' });
  }

  const computeHmac = (secret: string) =>
    crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

  const tryVerify = (secret: string): boolean => {
    const expected = computeHmac(secret);
    const sig = Buffer.from(signature.trim(), 'utf8');
    const exp = Buffer.from(expected, 'utf8');
    return sig.length === exp.length && crypto.timingSafeEqual(sig, exp);
  };

  if (tryVerify(adminSecret) || tryVerify(appSecret)) {
    return next();
  }

  return res.status(401).json({ error: 'Invalid webhook signature' });
}