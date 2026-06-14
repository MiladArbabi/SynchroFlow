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
import axios from 'axios';
import db from '@lasyncro/backend-core/db.js';
import { decrypt } from '../../security/encryption.service.js';
import { isValidTier, Tier, TIER_CONFIG } from '@lasyncro/backend-core/config/tiers.js';
import { getTierConfig } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { PEGGED_DISPLAY_PRICES } from '@lasyncro/backend-core/config/pricing.config.js';

/**
 * Resolve shop's Shopify access token for API calls.
 * Decrypts from integrations table.
 */
async function resolveShopifyAccessToken(shopId: number): Promise<{ accessToken: string; shopDomain: string }> {
  const integration = await db('integrations')
    .where({ shop_id: shopId, platform: 'shopify' })
    .first('access_token_encrypted', 'platform_shop_name');

  if (!integration) {
    throw new Error('SHOPIFY_INTEGRATION_NOT_FOUND');
  }

  const accessToken = decrypt(integration.access_token_encrypted, 'shopify.billing');
  return { accessToken, shopDomain: integration.platform_shop_name };
}

/**
 * POST /api/v1/shopify-billing/checkout
 *
 * Creates a Shopify RecurringApplicationCharge.
 * Returns confirmationUrl — shop owner must visit to approve.
 *
 * Body: { tier: 'core' | 'growth' | 'scale', interval: 'monthly' | 'annual' }
 */
export async function createShopifyCharge(req: Request, res: Response) {
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
    const billingOn = interval === 'annual' ? 365 : 30;
    const response = await axios.post(
      `https://${shopDomain}/admin/api/2024-01/recurring_application_charges.json`,
      {
        recurring_application_charge: {
          name: `LaSyncro ${(tier as string).charAt(0).toUpperCase() + (tier as string).slice(1)} (${interval === 'annual' ? 'Annual' : 'Monthly'})`,
          price,
          return_url: `${apiUrl}/api/v1/shopify-billing/callback?shopId=${shopId}&tier=${tier}&interval=${interval}`,
          trial_days: 0,
          // Annual: bill every 365 days
          ...(interval === 'annual' ? { billing_on: billingOn } : {}),
          test: process.env.NODE_ENV !== 'production',
        },
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const charge = response.data?.recurring_application_charge;
    if (!charge?.confirmation_url) {
      throw new Error('SHOPIFY_CHARGE_CREATION_FAILED');
    }

    console.log('[shopify-billing] charge created', { shopId, tier, interval, chargeId: charge.id });

    return res.json({ confirmationUrl: charge.confirmation_url, chargeId: charge.id });
  } catch (err: any) {
    console.error('[shopify-billing] createShopifyCharge failed', { shopId, err: err.message });
    return res.status(500).json({ error: 'SHOPIFY_CHARGE_FAILED' });
  }
}

/**
 * GET /api/v1/shopify-billing/callback
 *
 * Shopify redirects here after shop owner approves the charge.
 * Activates the charge and upserts shop_subscriptions.
 *
 * Query: { shopId, tier, interval, charge_id }
 */
export async function handleShopifyCallback(req: Request, res: Response) {
  const { shopId: rawShopId, tier, interval = 'monthly', charge_id } = req.query as Record<string, string>;
  const shopId = parseInt(rawShopId, 10);
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (!shopId || !isValidTier(tier) || !charge_id) {
    return res.redirect(`${frontendUrl}/settings/billing?error=INVALID_CALLBACK`);
  }

  try {
    const { accessToken, shopDomain } = await resolveShopifyAccessToken(shopId);

    // Activate the charge
    await axios.post(
      `https://${shopDomain}/admin/api/2024-01/recurring_application_charges/${charge_id}/activate.json`,
      {},
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );

    const tierConfig = getTierConfig(tier as Tier);
    const now = new Date();
    const periodEnd = new Date(now.getTime() + (interval === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000);

    // Upsert subscription record
    await db('shop_subscriptions')
      .insert({
        shop_id: shopId,
        tier,
        billing_interval: interval,
        status: 'active',
        trial_ends_at: null,
        current_period_start: now,
        current_period_end: periodEnd,
        updated_at: now,
      })
      .onConflict('shop_id')
      .merge([
        'tier',
        'billing_interval',
        'status',
        'trial_ends_at',
        'current_period_start',
        'current_period_end',
        'updated_at',
      ]);

    // Seed entitlements from tier constants
    const moduleRows = tierConfig.modules.map((moduleKey) => ({
      shop_id: shopId,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: `shopify_billing:${tier}`,
    }));

    const flagRows = tierConfig.flags.map((flagKey) => ({
      shop_id: shopId,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: `shopify_billing:${tier}`,
    }));

    await db.transaction(async (trx) => {
      await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);
    });

    console.log('[shopify-billing] charge activated', { shopId, tier, interval, charge_id });

    return res.redirect(`${frontendUrl}/settings/billing?success=1&tier=${tier}`);
  } catch (err: any) {
    console.error('[shopify-billing] callback failed', { shopId, err: err.message });
    return res.redirect(`${frontendUrl}/settings/billing?error=ACTIVATION_FAILED`);
  }
}

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