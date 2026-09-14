// Stripe Webhook Verification
// ---------------------------
//
// Stripe signs `${timestamp}.${rawBody}` and supplies one or more v1
// signatures in the Stripe-Signature header. Verification must use
// Stripe's official parser so timestamp tolerance, signature selection,
// and constant-time comparison remain aligned with Stripe's protocol.
//
// On success, req.body is replaced with the verified event returned by
// Stripe. The downstream adapter therefore never handles an unverified
// event object.

import { NextFunction, Request, Response } from 'express';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2026-06-24.dahlia'
});

export function verifyStripeSignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).json({
      error: 'Webhook secret not configured: STRIPE_WEBHOOK_SECRET',
    });
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    return res.status(400).json({
      error: 'Missing webhook signature header: stripe-signature',
    });
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return res.status(400).json({
      error: 'Missing raw request body',
    });
  }

  try {
    req.body = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret
    );
    return next();
  } catch (error) {
    console.error('[stripe.webhook] signature verification failed', {
      error: error instanceof Error ? error.message : 'Unknown verification error',
    });
    return res.status(400).json({
      error: 'Invalid webhook signature',
    });
  }
}