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
import { withTenant } from '@lasyncro/backend-core/db.js';
import { requireAuthStrict } from '@lasyncro/backend-core/middleware/requireAuthStrict.js';
import { ShopifyAppService } from '@lasyncro/backend-core/services/shopify-app.service.js';
import { performInitialSync } from '@lasyncro/backend-core/services/shopify.service.js';

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
    const integration = await withTenant(Number(shopId), (trx) =>
      trx('integrations')
        .where({ id: integrationId, shop_id: shopId })
        .first()
    );

    if (!integration) {
      return res.status(404).json({
        error: 'Integration not found',
      });
    }

    // 2. Resolve Shopify domain (NOT from shops)
    const installation = await withTenant(Number(shopId), (trx) =>
      trx('shopify_app_installations')
        .where({
          shop_id: shopId,
          uninstalled_at: null,
        })
        .select('shop_domain')
        .first()
    );

    if (!installation?.shop_domain) {
      return res.status(400).json({
        error: 'Shopify installation not found or uninstalled',
      });
    }

    const shopDomain = installation.shop_domain;

    // 3. Resolve decrypted access token
    const accessToken =
      await ShopifyAppService.getDecryptedAccessToken(shopDomain, Number(shopId));

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
