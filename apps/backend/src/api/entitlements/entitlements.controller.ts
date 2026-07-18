// apps/backend/src/api/entitlements/entitlements.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { resolveTierForShop } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { resolveShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';

/**
 * GET /api/v1/entitlements/me
 *
 * Returns modules + flags the current user is entitled to.
 */
export const getMyEntitlements = async (req: Request, res: Response) => {
  try {
    // 1. Must be authenticated
    if (!req.user || req.user.userId == null) { // Changed from !req.user.userId to req.user.userId == null
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;

    // 2. Load entitlements
    const entitlements = await EntitlementsService.getForUser(userId);
    
    // 3. No entitlements found → empty safe payload
    if (!entitlements) {
      return res.json({
        shopId: null,
        modules: [],
        flags: [],
        tier: 'starter',
      });
    }

    // --- DEV-ONLY SMART ASSERTION ---
    if (process.env.NODE_ENV !== 'production') {
      const modules = Array.isArray(entitlements.modules) ? entitlements.modules : [];

      if (!modules.includes('order-nexus')) {
        console.warn('[entitlements][DEV] Expected module missing', {
          userId,
          shopId: entitlements.shopId,
          missingModule: 'order-nexus',
          resolvedModules: modules
        });
      }
    }

    // 4. Return normalized snapshot — includes tier for frontend gating (MON-03)
    const tier = await resolveTierForShop(entitlements.shopId);
    const shopContext = await resolveShopContextForUser(userId);

    // Trial expiry — sourced from shop_subscriptions.trial_ends_at
    // Null if shop has an active paid subscription or no subscription row.
    const subscription = await db('shop_subscriptions')
      .where({ shop_id: entitlements.shopId })
      .first('trial_ends_at', 'status', 'billing_currency', 'billing_provider');
    const trialEndsAt =
      subscription?.status === 'trialing' && subscription?.trial_ends_at
        ? new Date(subscription.trial_ends_at).toISOString()
        : null;
    return res.json({
      shopId: entitlements.shopId ?? null,
      modules: Array.isArray(entitlements.modules) ? entitlements.modules :[],
      flags: Array.isArray(entitlements.flags) ? entitlements.flags : [],
      tier,
      trialEndsAt,
      displayCurrency: shopContext?.displayCurrency ?? 'USD',
      locale: shopContext?.locale ?? 'en-US',
      billingCurrency: subscription?.billing_currency ?? 'USD',
      // SHB-03/04: 'stripe' | 'shopify' — global billing-surface branch signal
      billingProvider: subscription?.billing_provider ?? 'stripe',
    });
  } catch (error) {
    console.error('Error fetching entitlements:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};