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
// - Shopify credentials/domain resolved ONLY from the canonical consumer boundary
// - Uses existing performInitialSync (no duplication)
// - Fail-fast, fail-closed

import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { requireAuthStrict } from '@lasyncro/backend-core/middleware/requireAuthStrict.js';
import { resolveShopifyAdminCredentialForConsumer } from '../../services/shopify/shopifyAdminCredentialConsumer.service.js';
import { performInitialSync } from '../../services/shopify.service.js';

export async function triggerManualInitialSync(
  req: Request,
  res: Response
) {
  try {
    // 🔐 Auth guard (required)
    requireAuthStrict(req);

    const { shopId: requestedShopId, integrationId: requestedIntegrationId } = req.body;

    if (!requestedShopId || !requestedIntegrationId) {
      return res.status(400).json({
        error: 'shopId and integrationId are required',
      });
    }

    const shopId = Number(requestedShopId);
    const integrationId = Number(requestedIntegrationId);

    // 1. Load integration (operational identity)
    const integration = await withTenant(shopId, (trx) =>
      trx('integrations')
        .where({ id: integrationId, shop_id: shopId })
        .first()
    );

    if (!integration) {
      return res.status(404).json({
        error: 'Integration not found',
      });
    }

    // The integration read has committed before canonical resolution.
    const credential = await resolveShopifyAdminCredentialForConsumer({
      shopId,
      now: new Date(),
    });
    if (credential.kind !== 'READY') {
      const status = credential.kind === 'REAUTH_REQUIRED' ? 400
        : credential.kind === 'PROVIDER_REJECTED' ? 502 : 503;
      return res.status(status).json({
        error: `SHOPIFY_CREDENTIAL_${credential.kind}`,
      });
    }

    await performInitialSync(
      credential.accessToken,
      credential.shopDomain,
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
