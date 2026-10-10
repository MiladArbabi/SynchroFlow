// apps/backend/src/api/shopify/shopify.billing.controller.ts
//
// Shopify Billing API (MON-09)
// ----------------------------
// Implements RecurringApplicationCharge for shops distributed
// via the Shopify App Store. Parallel to Stripe — shop chooses
// billing method at onboarding.
//
// Flow:
//   1. POST /shopify-billing/checkout → create RecurringApplicationCharge
//      → return confirmationUrl for shop owner to approve
//   2. GET  /shopify-billing/callback → Shopify redirects here after approval
//      → activate the charge → upsert shop_subscriptions
//   3. GET  /shopify-billing/subscription → current subscription state
//
// HARD RULES:
//   - Access token decrypted ONLY via encryption.service (context: 'shopify.billing')
//   - shopId embedded in return_url for callback routing
//   - Never grant entitlements here — update shop_subscriptions only
//     Entitlement seeding happens via handleSubscriptionUpsert pattern
//
// Env vars required:
//   SHOPIFY_API_KEY, SHOPIFY_API_SECRET
//   API_URL (for callback URL construction)
//   FRONTEND_URL (for post-activation redirect)

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * POST /api/v1/shopify-billing/checkout
 *
 * Creates a Shopify RecurringApplicationCharge.
 * Returns confirmationUrl — shop owner must visit to approve.
 *
 * Body: { tier: 'core' | 'growth' | 'scale', interval: 'monthly' | 'annual' }
 * 
 * RETIRED
 */
/* export async function createShopifyCharge(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const { tier, interval = 'monthly' } = req.body;

  if (!isValidTier(tier) || tier === 'starter') {
    return res.status(400).json({ error: 'INVALID_TIER', allowed: ['core', 'growth', 'scale'] });
  }

  if (interval !== 'monthly' && interval !== 'annual') {
    return res.status(400).json({ error: 'INVALID_INTERVAL', allowed: ['monthly', 'annual'] });
  }

  const tierPrices = PEGGED_DISPLAY_PRICES[tier as Tier]?.['USD'];
  if (!tierPrices) {
    return res.status(400).json({ error: 'TIER_PRICING_NOT_FOUND' });
  }
  try {
    const { accessToken, shopDomain } = await resolveShopifyAccessToken(shopId);
    const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
    // Shopify App Store always bills in USD — currency-agnostic path
    const price = (interval === 'annual' ? tierPrices.annual : tierPrices.monthly) / 100;
    const planName = `LaSyncro ${(tier as string).charAt(0).toUpperCase() + (tier as string).slice(1)} (${interval === 'annual' ? 'Annual' : 'Monthly'})`;
    const returnUrl = `${apiUrl}/api/v1/shopify-billing/callback?shopId=${shopId}&tier=${tier}&interval=${interval}`;
    const pricingInterval = interval === 'annual' ? 'ANNUAL' : 'EVERY_30_DAYS';
    const isTest = process.env.NODE_ENV !== 'production';

    const response = await axios.post(
      `https://${shopDomain}/admin/api/2024-01/graphql.json`,
      {
        query: `
          mutation {
            appSubscriptionCreate(
              name: ${JSON.stringify(planName)}
              returnUrl: ${JSON.stringify(returnUrl)}
              trialDays: 0
              test: ${isTest}
              lineItems: [{
                plan: {
                  appRecurringPricingDetails: {
                    price: { amount: "${price.toFixed(2)}", currencyCode: USD }
                    interval: ${pricingInterval}
                  }
                }
              }]
            ) {
              appSubscription { id }
              confirmationUrl
              userErrors { field message }
            }
          }
        `,
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const result = response.data?.data?.appSubscriptionCreate;
    const userErrors = result?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.error('[shopify-billing] appSubscriptionCreate userErrors', { shopId, userErrors });
      throw new Error('SHOPIFY_CHARGE_CREATION_FAILED');
    }

    const confirmationUrl = result?.confirmationUrl;
    const chargeId = result?.appSubscription?.id;
    if (!confirmationUrl) {
      throw new Error('SHOPIFY_CHARGE_CREATION_FAILED');
    }

    console.log('[shopify-billing] charge created', { shopId, tier, interval, chargeId });

    return res.json({ confirmationUrl, chargeId });
  } catch (err: any) {
    console.error('[shopify-billing] createShopifyCharge failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'SHOPIFY_CHARGE_FAILED' });
  }
} */

/**
 * GET /api/v1/shopify-billing/callback
 *
 * Shopify redirects here after shop owner approves the charge.
 * Activates the charge and upserts shop_subscriptions.
 *
 * Query: { shopId, tier, interval, charge_id }
 */
export async function handleShopifyCallback(req: Request, res: Response) {
  // Unmounted compatibility tombstone; Managed Pricing owns billing transitions.
  return res.status(410).json({ error: 'SHOPIFY_BILLING_CALLBACK_RETIRED' });
};

/**
 * POST /api/v1/shopify-billing/change-plan
 *
 * Allows merchants to upgrade or downgrade their Shopify billing plan
 * without reinstalling the app. Cancels the existing active charge and
 * creates a new RecurringApplicationCharge for the new tier/interval.
 *
 * Body: { tier: 'core' | 'growth' | 'scale', interval: 'monthly' | 'annual' }
 * 
 * RETIRED
 */
/* export async function changeShopifyPlan(req: Request, res: Response) {
  const shopId = req.user!.shopId!;
  const { tier, interval = 'monthly' } = req.body;

  if (!isValidTier(tier) || tier === 'starter') {
    return res.status(400).json({ error: 'INVALID_TIER', allowed: ['core', 'growth', 'scale'] });
  }

  if (interval !== 'monthly' && interval !== 'annual') {
    return res.status(400).json({ error: 'INVALID_INTERVAL', allowed: ['monthly', 'annual'] });
  }

  const tierPrices = PEGGED_DISPLAY_PRICES[tier as Tier]?.['USD'];
  if (!tierPrices) {
    return res.status(400).json({ error: 'TIER_PRICING_NOT_FOUND' });
  }

  try {
    const { accessToken, shopDomain } = await resolveShopifyAccessToken(shopId);
    const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

    // replacementBehavior: APPLY_IMMEDIATELY cancels existing subscription atomically — no manual GET/DELETE loop needed
    const price = (interval === 'annual' ? tierPrices.annual : tierPrices.monthly) / 100;
    const planName = `LaSyncro ${(tier as string).charAt(0).toUpperCase() + (tier as string).slice(1)} (${interval === 'annual' ? 'Annual' : 'Monthly'})`;
    const returnUrl = `${apiUrl}/api/v1/shopify-billing/callback?shopId=${shopId}&tier=${tier}&interval=${interval}`;
    const pricingInterval = interval === 'annual' ? 'ANNUAL' : 'EVERY_30_DAYS';
    const isTest = process.env.NODE_ENV !== 'production';

    const response = await axios.post(
      `https://${shopDomain}/admin/api/2024-01/graphql.json`,
      {
        query: `
          mutation {
            appSubscriptionCreate(
              name: ${JSON.stringify(planName)}
              returnUrl: ${JSON.stringify(returnUrl)}
              trialDays: 0
              test: ${isTest}
              replacementBehavior: APPLY_IMMEDIATELY
              lineItems: [{
                plan: {
                  appRecurringPricingDetails: {
                    price: { amount: "${price.toFixed(2)}", currencyCode: USD }
                    interval: ${pricingInterval}
                  }
                }
              }]
            ) {
              appSubscription { id }
              confirmationUrl
              userErrors { field message }
            }
          }
        `,
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const result = response.data?.data?.appSubscriptionCreate;
    const userErrors = result?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.error('[shopify-billing] plan change userErrors', { shopId, userErrors });
      throw new Error('SHOPIFY_CHARGE_CREATION_FAILED');
    }

    const confirmationUrl = result?.confirmationUrl;
    const chargeId = result?.appSubscription?.id;
    if (!confirmationUrl) {
      throw new Error('SHOPIFY_CHARGE_CREATION_FAILED');
    }

    console.log('[shopify-billing] plan change charge created', { shopId, tier, interval, chargeId });

    return res.json({ confirmationUrl, chargeId });
  } catch (err: any) {
    console.error('[shopify-billing] changeShopifyPlan failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'PLAN_CHANGE_FAILED' });
  }
} */

/**
 * GET /api/v1/shopify-billing/subscription
 *
 * Returns current subscription state for the authenticated shop.
 */
export async function getShopifySubscription(req: Request, res: Response) {
  const shopId = req.user!.shopId!;

  try {
    const row = await db('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_interval', 'trial_ends_at', 'current_period_start', 'current_period_end');

    return res.json(row ?? { tier: 'starter', status: 'active', billing_interval: 'monthly' });
  } catch (err: any) {
    console.error('[shopify-billing] getShopifySubscription failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'SUBSCRIPTION_FETCH_FAILED' });
  }
}