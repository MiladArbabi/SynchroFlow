//apps/backend/src/api/shopify/dev.routes.ts
// apps/backend/src/api/shopify/dev.routes.ts
import { Router, Request, Response } from 'express';
import db from '../../db';
import { performSmartSync } from '../../services/shopify-sync-orchestrator.service';
import CryptoJS from 'crypto-js';

const router = Router();

const decryptToken = (encryptedToken: string): string => {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not set in environment.');
  }
  return CryptoJS.AES.decrypt(encryptedToken, secret).toString(CryptoJS.enc.Utf8);
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
