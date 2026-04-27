// apps/backend/src/api/operators/operators.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * OPERATOR AVAILABILITY API (PP10-03)
 * ------------------------------------
 * Operators mark days available/unavailable on mobile calendar.
 * Owner reads team availability to assign tasks.
 *
 * GET  /api/v1/operators/availability?week=YYYY-MM-DD  — fetch week for current user
 * POST /api/v1/operators/availability                  — upsert a day
 * GET  /api/v1/operators/team-availability?week=...    — owner sees full team (owner/admin only)
 */

// ─────────────────────────────────────────
// GET /api/v1/operators/availability
// ─────────────────────────────────────────
export const httpGetMyAvailability = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const week = req.query.week as string | undefined;
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'week param required in YYYY-MM-DD format (start of week)' });
  }

  const weekStart = new Date(week);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const rows = await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    return trx('operator_availability')
      .where({ shop_id: shopId, user_id: userId })
      .whereBetween('date', [week, weekEnd.toISOString().split('T')[0]])
      .select('id', 'date', 'is_available', 'notes');
  });

  return res.json({ availability: rows });
};

// ─────────────────────────────────────────
// POST /api/v1/operators/availability
// ─────────────────────────────────────────
export const httpUpsertAvailability = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const { date, is_available, notes } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required in YYYY-MM-DD format' });
  }
  if (typeof is_available !== 'boolean') {
    return res.status(400).json({ error: 'is_available must be a boolean' });
  }

  const row = await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    const [result] = await trx('operator_availability')
      .insert({
        shop_id: shopId,
        user_id: userId,
        date,
        is_available,
        notes: notes ?? null,
      })
      .onConflict(['shop_id', 'user_id', 'date'])
      .merge({ is_available, notes: notes ?? null, updated_at: trx.fn.now() })
      .returning(['id', 'date', 'is_available', 'notes']);
    return result;
  });

  console.info('[OPERATOR_AVAILABILITY_UPSERTED]', { shopId, userId, date, is_available });
  return res.json({ availability: row });
};

// ─────────────────────────────────────────
// GET /api/v1/operators/team-availability
// ─────────────────────────────────────────
export const httpGetTeamAvailability = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const week = req.query.week as string | undefined;
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'week param required in YYYY-MM-DD format' });
  }

  const weekEnd = new Date(week);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const rows = await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    return trx('operator_availability as oa')
      .join('users as u', 'u.id', 'oa.user_id')
      .where('oa.shop_id', shopId)
      .whereBetween('oa.date', [week, weekEnd.toISOString().split('T')[0]])
      .select(
        'oa.date',
        'oa.is_available',
        'oa.notes',
        'u.id as user_id',
        'u.name as operator_name',
      )
      .orderBy(['oa.date', 'u.name']);
  });

  return res.json({ team_availability: rows });
};