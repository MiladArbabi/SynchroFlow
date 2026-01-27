// apps/backend/src/api/integrations/manualSync.controller.ts

// apps/backend/src/api/integrations/manualSync.controller.ts
//
// MANUAL INITIAL SYNC TRIGGER (ADMIN / DEV ONLY)
//
// PURPOSE:
// - Force-run Shopify initial sync for an existing integration
// - Used ONLY for recovery / bootstrap scenarios
//
// HARD RULES:
// - Explicit shopId required
// - Explicit integrationId required
// - Shopify domain resolved ONLY from shopify_app_installations
// - Uses existing performInitialSync (no duplication)
// - Fail-fast, fail-closed

import { Request, Response } from 'express';
import db from 'api-src/db';
import { performInitialSync } from 'api-src/services/shopify.service';
import { ShopifyAppService } from 'api-src/services/shopify-app.service';
import { requireAuthStrict } from 'api-src/middleware/requireAuthStrict';

export async function triggerManualInitialSync(
  req: Request,
  res: Response
) {
  try {
    // 🔐 Auth guard (required)
    requireAuthStrict(req);

    const { shopId, integrationId } = req.body;

    if (!shopId || !integrationId) {
      return res.status(400).json({
        error: 'shopId and integrationId are required',
      });
    }

    // 1. Load integration (authoritative)
    const integration = await db('integrations')
      .where({ id: integrationId, shop_id: shopId })
      .first();

    if (!integration) {
      return res.status(404).json({
        error: 'Integration not found',
      });
    }

    // 2. Resolve Shopify domain (NOT from shops)
    const installation = await db('shopify_app_installations')
      .where({
        shop_id: shopId,
        uninstalled_at: null,
      })
      .select('shop_domain')
      .first();

    if (!installation?.shop_domain) {
      return res.status(400).json({
        error: 'Shopify installation not found or uninstalled',
      });
    }

    const shopDomain = installation.shop_domain;

    // 3. Resolve decrypted access token
    const accessToken =
      await ShopifyAppService.getDecryptedAccessToken(shopDomain);

    if (!accessToken) {
      return res.status(400).json({
        error: 'Missing Shopify access token for shop',
      });
    }

    // 4. Execute initial sync (authoritative, single-shot)
    await performInitialSync(
      accessToken,
      shopDomain,
      shopId,
      integrationId
    );

    return res.status(200).json({
      status: 'initial_sync_triggered',
      shopId,
      integrationId,
    });
  } catch (err: any) {
    console.error('[manualInitialSync] failed', err);

    return res.status(500).json({
      error: 'Initial sync failed',
      details: err?.message ?? 'unknown_error',
    });
  }
}