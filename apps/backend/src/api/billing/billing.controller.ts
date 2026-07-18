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
import db, { withTenant } from '@lasyncro/backend-core/db.js';
import { isValidTier, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { 
  getStripePriceId, 
  getSeatPriceId, 
  SeatTier, 
  PEGGED_DISPLAY_PRICES, 
  BillingCurrency 
} from '@lasyncro/backend-core/config/pricing.config.js';
import { getOrRotateOpenUsagePeriod } from './usagePeriod.service.js';

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('[billing] STRIPE_SECRET_KEY not set');
  return new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
};

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
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    // Retrieve or create Stripe customer
    const subRow = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('stripe_customer_id', 'billing_currency', 'billing_provider');

    if (subRow?.billing_provider === 'shopify') {
      return res.status(403).json({ error: 'APP_STORE_MERCHANT' });
    }

    const billingCurrency = (subRow?.billing_currency ?? 'USD') as BillingCurrency;
    const priceId = getStripePriceId(tier as Exclude<Tier, 'starter'>, billingCurrency, interval);
    let customerId: string | undefined = subRow?.stripe_customer_id ?? undefined;

    if (!customerId) {
      const shop = await db('shops').where({ id: shopId }).first('name');
      const customer = await stripe.customers.create({
        name: shop?.name ?? `Shop ${shopId}`,
        metadata: { shopId: String(shopId) },
      });
      customerId = customer.id;
    }

    const monthlyMinor = PEGGED_DISPLAY_PRICES[tier as Tier][billingCurrency].monthly;
    const annualSavings = interval === 'annual'
      ? Math.round((monthlyMinor * 12 * 0.2) / 100)
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
          ? { description: `Save ${annualSavings} ${billingCurrency}/year vs monthly` }
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
 * POST /api/v1/billing/setup-payment-method
 *
 * Creates a Stripe Checkout session in 'setup' mode — saves a card,
 * no subscription, no charge. Used by Starter shops opting into
 * pay-per-order overage (SEG-022-B) without buying a paid tier.
 *
 * Reuses createCheckoutSession's customer-resolution pattern but
 * intentionally does NOT gate on tier — Starter is the primary caller.
 */
export async function createSetupSession(req: Request, res: Response) {
  const shopId = req.user!.shopId!;

  try {
    const stripe = getStripe();
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    const subRow = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('stripe_customer_id', 'billing_provider');

    if (subRow?.billing_provider === 'shopify') {
      return res.status(403).json({ error: 'APP_STORE_MERCHANT' });
    }

    let customerId: string | undefined = subRow?.stripe_customer_id ?? undefined;

    if (!customerId) {
      const shop = await db('shops').where({ id: shopId }).first('name');
      const customer = await stripe.customers.create({
        name: shop?.name ?? `Shop ${shopId}`,
        metadata: { shopId: String(shopId) },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'setup',
      payment_method_types: ['card'],
      success_url: `${frontendUrl}/settings/billing?ppo=1`,
      cancel_url: `${frontendUrl}/settings/billing?ppo_canceled=1`,
      metadata: {
        shopId: String(shopId),
        purpose: 'pay_per_order_setup',
      },
    });

    console.log('[billing] setup session created', { shopId, sessionId: session.id });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing] createSetupSession failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'SETUP_SESSION_FAILED' });
  }
}

/**
 * POST /api/v1/billing/add-seats
 *
 * Adds N extra seats to the shop's existing Stripe subscription as a
 * new subscription item (AUD-C16). Requires an active paid subscription
 * — Starter has no subscription to attach to, and Scale has unlimited
 * seats already.
 *
 * Body: { quantity: number } — total extra seats desired (not delta).
 * Stripe subscriptionItems.create is called once if no seat item exists
 * yet; subsequent calls should update quantity via a future PATCH
 * (not built in this pass — MVP only supports initial add).
 */
export async function addSeats(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const { quantity } = req.body;

  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'INVALID_QUANTITY' });
  }

  try {
    const subRow = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'stripe_subscription_id', 'billing_currency', 'billing_provider', 'extra_seats');

    if (subRow?.billing_provider === 'shopify') {
      return res.status(403).json({ error: 'APP_STORE_MERCHANT' });
    }

    if (subRow?.tier !== 'core' && subRow?.tier !== 'growth') {
      return res.status(400).json({ error: 'SEATS_NOT_APPLICABLE_FOR_TIER' });
    }

    if (!subRow?.stripe_subscription_id) {
      return res.status(400).json({ error: 'NO_ACTIVE_SUBSCRIPTION' });
    }

    const stripe = getStripe();
    const billingCurrency = (subRow.billing_currency ?? 'USD') as BillingCurrency;
    const priceId = getSeatPriceId(subRow.tier as SeatTier, billingCurrency);

    const subscriptionItem = await stripe.subscriptionItems.create({
      subscription: subRow.stripe_subscription_id,
      price: priceId,
      quantity,
    });

    console.log('[billing] seat item added', { shopId, quantity, itemId: subscriptionItem.id });

    return res.json({ success: true, subscriptionItemId: subscriptionItem.id, quantity });
  } catch (err: any) {
    console.error('[billing] addSeats failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'ADD_SEATS_FAILED' });
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
      .first('stripe_customer_id', 'billing_provider');

    if (subRow?.billing_provider === 'shopify') {
      return res.status(403).json({ error: 'APP_STORE_MERCHANT' });
    }

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
    // ISS-RLS1 fix: this bare db() call previously ran with no tenant
    // context, so RLS silently returned zero rows for the shop's own
    // data. withTenant() sets SET LOCAL app.current_tenant for this
    // transaction only, matching RLS_blueprint.md §3.
    const usage = await withTenant(shopId, async (trx) => {
      // Reads also rotate stale Starter periods so an idle shop sees a
      // fresh monthly allowance before its next order or shipment.
      return getOrRotateOpenUsagePeriod(trx, shopId);
    });

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
        'canceled_at',
        // SHB-03/04: provider drives frontend billing-surface branching
        'billing_provider'
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
        billing_provider: 'stripe',
        manage_billing_url: null,
      });
    }

    // SHB-03/04: Shopify-billed shops manage plans on Shopify's hosted
    // Managed Pricing page — compose the URL server-side so the frontend
    // never hardcodes the app handle. Requires SHOPIFY_APP_HANDLE env var.
    let manageBillingUrl: string | null = null;
    if (row.billing_provider === 'shopify') {
      const appHandle = process.env.SHOPIFY_APP_HANDLE;
      const install = await db('shopify_app_installations')
        .where({ shop_id: shopId })
        .whereNull('uninstalled_at')
        .first('shop_domain');
      if (appHandle && install?.shop_domain) {
        const storeHandle = install.shop_domain.replace('.myshopify.com', '');
        manageBillingUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
      } else {
        // No silent failure: surface the misconfiguration in logs
        console.warn('[billing] getSubscription: shopify provider but cannot compose manage_billing_url', {
          shopId, hasAppHandle: !!appHandle, hasDomain: !!install?.shop_domain,
        });
      }
    }

    return res.json({ ...row, manage_billing_url: manageBillingUrl });
  } catch (err: any) {
    console.error('[billing] getSubscription failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'SUBSCRIPTION_FETCH_FAILED' });
  }
}