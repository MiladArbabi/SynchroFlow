// apps/backend/src/api/specter/specter.controller.ts
import { Request, Response } from 'express';
import db from 'api-src/db';
import { User } from 'api-types';

// --- Helper: resolve shop_id for the authenticated user ---
const getShopIdFromRequest = async (req: Request): Promise<number | null> => {
  const authUser = (req as any).user;
  if (!authUser || !authUser.userId) return null;

  const user = await db<User>('users')
    .where({ id: authUser.userId })
    .first('shop_id');

  return user?.shop_id ?? null;
};

// --- GET /api/v1/specter/config ---
export const getSpecterConfig = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);

    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    const row = await db('specter_shop_configs')
      .where({ shop_id: shopId })
      .first();

    if (!row) {
      return res.json({
        shopId,
        config: null,
      });
    }

    return res.json({
      shopId,
      config: row.config_json ?? null,
    });
  } catch (err) {
    console.error('[specter.controller] Error in getSpecterConfig:', err);
    return res.status(500).json({ error: 'Failed to fetch Specter config.' });
  }
};

// --- PUT /api/v1/specter/config ---
export const upsertSpecterConfig = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);

    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    const { config } = req.body as { config?: unknown };

    // Basic payload validation: must be a plain object
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({
        error:
          'Invalid config payload. Expected a JSON object under "config".',
      });
    }

    // Upsert semantics on shop_id
    const [row] = await db('specter_shop_configs')
      .insert({
        shop_id: shopId,
        config_json: config,
      })
      .onConflict('shop_id')
      .merge()
      .returning(['shop_id', 'config_json']);

    return res.json({
      shopId: row.shop_id,
      config: row.config_json,
    });
  } catch (err) {
    console.error('[specter.controller] Error in upsertSpecterConfig:', err);
    return res
      .status(500)
      .json({ error: 'Failed to upsert Specter config.' });
  }
};
