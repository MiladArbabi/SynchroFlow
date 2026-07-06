// apps/backend/src/api/returns/returns.settings.controller.ts
//
// GET  /api/v1/modules/returns/settings
// PATCH /api/v1/modules/returns/settings
// -----------------------------------------
// Returns-aging thresholds. Fields live in shop_operational_settings
// (same table as fulfillment_sla_hours) — see cashflow.settings.controller.ts
// for the sibling pattern this mirrors.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export const httpGetReturnsSettings = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const row = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('shop_operational_settings')
        .where('shop_id', shopId)
        .select('returns_aging_warning_hours', 'returns_aging_critical_hours')
        .first();
    });

    return res.status(200).json({
      returns_aging_warning_hours: row?.returns_aging_warning_hours ?? 48,
      returns_aging_critical_hours: row?.returns_aging_critical_hours ?? 168,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: `Failed to fetch returns settings: ${message}` });
  }
};

export const httpPatchReturnsSettings = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const { returns_aging_warning_hours, returns_aging_critical_hours } = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (returns_aging_warning_hours !== undefined) {
      const val = Number(returns_aging_warning_hours);
      if (isNaN(val) || val < 1 || val > 720) {
        return res.status(400).json({ error: 'returns_aging_warning_hours must be between 1 and 720' });
      }
      updates.returns_aging_warning_hours = val;
    }

    if (returns_aging_critical_hours !== undefined) {
      const val = Number(returns_aging_critical_hours);
      if (isNaN(val) || val < 1 || val > 2160) {
        return res.status(400).json({ error: 'returns_aging_critical_hours must be between 1 and 2160' });
      }
      updates.returns_aging_critical_hours = val;
    }

    if (
      updates.returns_aging_warning_hours !== undefined &&
      updates.returns_aging_critical_hours !== undefined &&
      (updates.returns_aging_critical_hours as number) <= (updates.returns_aging_warning_hours as number)
    ) {
      return res.status(400).json({ error: 'returns_aging_critical_hours must be greater than returns_aging_warning_hours' });
    }

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx('shop_operational_settings')
        .insert({ shop_id: shopId, fulfillment_sla_hours: 24, ...updates })
        .onConflict('shop_id')
        .merge({ ...updates, updated_at: new Date() });
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: `Failed to update returns settings: ${message}` });
  }
};