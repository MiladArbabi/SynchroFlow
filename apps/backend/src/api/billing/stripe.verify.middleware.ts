import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

export function verifyStripeSignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // Explicit fail-closed
  if (!secret) {
    return res.status(500).json({ error: 'Stripe webhook secret not configured' });
  }

  const signature = req.headers[STRIPE_SIGNATURE_HEADER] as string | undefined;
  if (!signature) {
    return res.status(400).json({ error: 'Missing Stripe signature' });
  }

  // Stripe signs the *raw* request body
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    return res.status(400).json({ error: 'Missing raw request body' });
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (!signature.includes(expected)) {
    return res.status(400).json({ error: 'Invalid Stripe signature' });
  }

  return next();
}