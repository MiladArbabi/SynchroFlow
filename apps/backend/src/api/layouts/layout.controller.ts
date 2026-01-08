// apps/backend/src/api/layouts/layout.controller.ts
import { Request, Response } from 'express';
import db from '../../db';
import { requireShopIdForUser } from 'api-src/services/shop-resolution.service';

/**
 * Layout Controller
 * =================
 * Persists and retrieves dashboard layouts scoped by shop.
 *
 * Invariants:
 * - Shop resolution via shop-resolution.service ONLY
 * - No direct access to users table
 * - shopId is non-nullable
 */

export const getLayout = async (req: Request, res: Response) => {
  const { layoutName } = req.params;

  try {
    const shopId = await requireShopIdForUser(req.user!.userId);

    let layout;
    try {
      layout = await db('layouts')
        .where({ shop_id: shopId, name: layoutName })
        .first();
    } catch (err: any) {
      // Layouts table not deployed yet
      if (err.code === '42P01') {
        return res.status(200).json({ layout: [], activeWidgets: [] });
      }
      throw err;
    }

    if (layout) {
      return res.status(200).json(layout);
    }

    // No layout → check if shop has integrations
    const hasIntegration = await db('integrations')
      .where({ shop_id: shopId })
      .first('id');

    if (hasIntegration) {
      return res.status(200).json({ layout: [], activeWidgets: [] });
    }

    return res
      .status(404)
      .json({ error: `Layout '${layoutName}' not found.` });
  } catch (err) {
    console.error('[layout] getLayout failed', err);
    res.status(500).json({ error: 'Failed to fetch layout.' });
  }
};

export const saveLayout = async (req: Request, res: Response) => {
  const { layoutName } = req.params;
  const { layout, activeWidgets } = req.body;

  try {
    const shopId = await requireShopIdForUser(req.user!.userId);

    await db('layouts')
      .insert({
        shop_id: shopId,
        name: layoutName,
        layout: JSON.stringify(layout),
        activeWidgets: JSON.stringify(activeWidgets),
      })
      .onConflict(['shop_id', 'name'])
      .merge();

    res.status(200).json({
      message: `Layout '${layoutName}' saved successfully.`,
    });
  } catch (err) {
    console.error('[layout] saveLayout failed', err);
    res.status(500).json({ error: 'Failed to save layout.' });
  }
};
