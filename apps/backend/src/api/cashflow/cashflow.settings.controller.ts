// apps/backend/src/api/cashflow/cashflow.settings.controller.ts
//
// GET  /api/v1/modules/cashflow/settings
// PATCH /api/v1/modules/cashflow/settings
// -----------------------------------------
// Shop-level cash flow overhead settings.
// Stores monthly fixed costs + starting cash balance for accurate projection.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export const httpGetCashFlowSettings = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    await db.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const row = await db('shop_operational_settings')
      .where('shop_id', shopId)
      .select('monthly_overhead_amount', 'starting_cash_balance', 'starting_cash_balance_set_at')
      .first();

    return res.status(200).json({
      monthly_overhead_amount: row?.monthly_overhead_amount ? Number(row.monthly_overhead_amount) : null,
      starting_cash_balance: row?.starting_cash_balance ? Number(row.starting_cash_balance) : null,
      starting_cash_balance_set_at: row?.starting_cash_balance_set_at ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: `Failed to fetch cashflow settings: ${message}` });
  }
};

export const httpPatchCashFlowSettings = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const { monthly_overhead_amount, starting_cash_balance } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (monthly_overhead_amount !== undefined) {
      const val = Number(monthly_overhead_amount);
      if (isNaN(val) || val < 0) return res.status(400).json({ error: 'monthly_overhead_amount must be a positive number' });
      updates.monthly_overhead_amount = val;
    }

    if (starting_cash_balance !== undefined) {
      const val = Number(starting_cash_balance);
      if (isNaN(val)) return res.status(400).json({ error: 'starting_cash_balance must be a number' });
      updates.starting_cash_balance = val;
      updates.starting_cash_balance_set_at = new Date();
    }

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx('shop_operational_settings')
        .insert({ shop_id: shopId, fulfillment_sla_hours: 24, ...updates })
        .onConflict('shop_id')
        .merge(updates);
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: `Failed to update cashflow settings: ${message}` });
  }
};