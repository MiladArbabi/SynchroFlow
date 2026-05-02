// apps/backend/src/api/billing/billing.controller.ts
//
// Billing Controller (MON-08)
// ----------------------------
// Stripe Checkout session creation, Customer Portal, and plan management.
//
// Annual billing (MON-08):
//   - Each tier has two Stripe Price IDs: monthly and annual
//   - Annual = 20% discount (~2 months free)
//   - Price IDs are read from env vars — never hardcoded
//
// Env vars required:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_CORE_MONTHLY, STRIPE_PRICE_CORE_ANNUAL
//   STRIPE_PRICE_GROWTH_MONTHLY, STRIPE_PRICE_GROWTH_ANNUAL
//   STRIPE_PRICE_SCALE_MONTHLY, STRIPE_PRICE_SCALE_ANNUAL
//   FRONTEND_URL (for redirect URLs)
//
// HARD RULES:
//   - shopId MUST be embedded in Stripe metadata on every checkout
//   - Stripe webhook handler reads metadata.shopId to route events
//   - Never grant entitlements here — that is the webhook handler's job

import { Request, Response } from 'express';
import Stripe from 'stripe';
import db from '@lasyncro/backend-core/db.js';
import { isValidTier, Tier, TIER_CONFIG } from '@lasyncro/backend-core/config/tiers.js';

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('[billing] STRIPE_SECRET_KEY not set');
  return new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
}

/**
 * Stripe Price ID map.
 * Read from env vars — allows different prices per environment.
 * Format: STRIPE_PRICE_<TIER>_<INTERVAL>
 */
function getPriceId(tier: Tier, interval: 'monthly' | 'annual'): string {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  const priceId = process.env[key];
  if (!priceId) {
    throw new Error(`[billing] Missing env var: ${key}`);
  }
  return priceId;
}

/**
 * POST /api/v1/billing/checkout
 *
 * Creates a Stripe Checkout session for the requested tier + interval.
 * Redirects user to Stripe-hosted checkout page.
 *
 * Body: { tier: 'core' | 'growth' | 'scale', interval: 'monthly' | 'annual' }
 */
export async function createCheckoutSession(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const { tier, interval = 'monthly' } = req.body;

  if (!isValidTier(tier) || tier === 'starter') {
    return res.status(400).json({ error: 'INVALID_TIER', allowed: ['core', 'growth', 'scale'] });
  }

  if (interval !== 'monthly' && interval !== 'annual') {
    return res.status(400).json({ error: 'INVALID_INTERVAL', allowed: ['monthly', 'annual'] });
  }

  try {
    const stripe = getStripe();
    const priceId = getPriceId(tier as Tier, interval);
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const tierConfig = TIER_CONFIG[tier as Tier];

    // Retrieve or create Stripe customer
    const subRow = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('stripe_customer_id');

    let customerId: string | undefined = subRow?.stripe_customer_id ?? undefined;

    if (!customerId) {
      const shop = await db('shops').where({ id: shopId }).first('name');
      const customer = await stripe.customers.create({
        name: shop?.name ?? `Shop ${shopId}`,
        metadata: { shopId: String(shopId) },
      });
      customerId = customer.id;
    }

    // Annual savings callout for Growth tier
    const annualSavings = interval === 'annual'
      ? Math.round((tierConfig.monthlyPriceCents * 12 * 0.2) / 100)
      : null;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: {
          shopId: String(shopId),
          tier,
          billing_interval: interval,
        },
        // Annual savings callout shown in Stripe checkout
        ...(annualSavings && interval === 'annual'
          ? { description: `Save $${annualSavings}/year vs monthly` }
          : {}),
      },
      success_url: `${frontendUrl}/settings/billing?success=1&tier=${tier}`,
      cancel_url: `${frontendUrl}/settings/billing?canceled=1`,
      metadata: {
        shopId: String(shopId),
        tier,
        billing_interval: interval,
      },
    });

    console.log('[billing] checkout session created', { shopId, tier, interval, sessionId: session.id });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing] createCheckoutSession failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'CHECKOUT_SESSION_FAILED' });
  }
}

/**
 * POST /api/v1/billing/portal
 *
 * Creates a Stripe Customer Portal session.
 * Allows shop owner to manage subscription, update payment, cancel.
 */
export async function createPortalSession(req: Request, res: Response) {
  const shopId = req.user!.shopId!;

  try {
    const subRow = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('stripe_customer_id');

    if (!subRow?.stripe_customer_id) {
      return res.status(404).json({ error: 'NO_STRIPE_CUSTOMER' });
    }

    const stripe = getStripe();
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    const session = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: `${frontendUrl}/settings/billing`,
    });

    console.log('[billing] portal session created', { shopId });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing] createPortalSession failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'PORTAL_SESSION_FAILED' });
  }
}

/**
 * GET /api/v1/billing/usage
 * Returns current period order usage vs cap for the authenticated shop.
 */
export async function getUsage(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  try {
    // Current open period — period_ends_at IS NULL
    const usage = await db('shop_usage_metrics')
      .where({ shop_id: shopId })
      .whereNull('period_ends_at')
      .orderBy('period_starts_at', 'desc')
      .first('ingested_orders', 'shipped_orders', 'tier_at_period_start', 'period_starts_at');

    return res.json({
      ingested_orders: usage?.ingested_orders ?? 0,
      shipped_orders: usage?.shipped_orders ?? 0,
      tier: usage?.tier_at_period_start ?? 'starter',
      period_starts_at: usage?.period_starts_at ?? null,
    });
  } catch (err: any) {
    console.error('[billing] getUsage failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'Failed to fetch usage' });
  }
}

/**
 * GET /api/v1/billing/subscription
 *
 * Returns current subscription state for the authenticated shop.
 * Used by frontend billing settings page.
 */
export async function getSubscription(req: Request, res: Response) {
  const shopId = req.user!.shopId!;

  try {
    const row = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first(
        'tier',
        'status',
        'billing_interval',
        'trial_ends_at',
        'current_period_start',
        'current_period_end',
        'canceled_at'
      );

    if (!row) {
      return res.json({
        tier: 'starter',
        status: 'active',
        billing_interval: 'monthly',
        trial_ends_at: null,
        current_period_start: null,
        current_period_end: null,
        canceled_at: null,
      });
    }

    return res.json(row);
  } catch (err: any) {
    console.error('[billing] getSubscription failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'SUBSCRIPTION_FETCH_FAILED' });
  }
}