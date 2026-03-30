//apps/backend/src/api/shopify/dev.routes.ts
// apps/backend/src/api/shopify/dev.routes.ts
import { Router, Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { performSmartSync } from '../../services/shopify-sync-orchestrator.service.js';
import { decrypt } from '../../security/encryption.service.js';

const router = Router();

// CENTRALIZED DECRYPTION
// NOTE: Delegates to encryption.service (single source of truth)
const decryptToken = (encryptedToken: string): string => {
  return decrypt(encryptedToken, 'shopify.dev');
};

/**
 * DEV ONLY
 * Manually trigger Shopify smart sync for the latest active integration.
 */
router.post('/dev/trigger-sync', async (_req: Request, res: Response) => {
  try {
    const integration = await db('integrations')
        .where({ platform: 'shopify' })
        .orderBy('created_at', 'desc')
        .first();

    if (!integration) {
      return res.status(404).json({ error: 'No active Shopify integration found' });
    }

    const {
      access_token_encrypted,
      platform_shop_name,
      shop_id,
      id: integration_id,
    } = integration;

    if (!access_token_encrypted || !platform_shop_name || !shop_id) {
      return res.status(400).json({ error: 'Integration is missing required fields' });
    }

    // SECURITY GUARD: Prevent token decryption outside safe environments
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] Token decryption via dev route is blocked in production');
    }

    const accessToken = decryptToken(access_token_encrypted);

    console.log('[DEV] Triggering Shopify smart sync', {
      accessToken,
      shop_id,
      integration_id,
      platform_shop_name,
    });

    await performSmartSync(
      accessToken,
      platform_shop_name,
      shop_id,
      integration_id
    );

    return res.status(200).json({ status: 'sync completed' });
  } catch (err: any) {
    console.error('[DEV] trigger-sync failed:', err);
    return res.status(500).json({
      error: err?.message ?? 'Unknown error',
    });
  }
});

export default router;
