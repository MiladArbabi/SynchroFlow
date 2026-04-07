// apps/backend/src/api/alerts/alerts.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/alerts
 * ------------------
 * Returns ranked operator alert inbox for the authenticated shop.
 *
 * Ranking:
 * 1. severity: critical > warning > info
 * 2. revenue_impact DESC (higher commercial impact first)
 * 3. created_at DESC (newest first)
 *
 * Query params:
 * - active_only: boolean (default true) — filter to is_active = true
 * - limit: number (default 20, max 50)
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Read-only
 * - RLS enforced via SET LOCAL app.current_tenant
 */
export const httpGetAlerts = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const activeOnly = req.query.active_only !== 'false';
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

    const alerts = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const query = trx('alerts')
        .where({ shop_id: shopId })
        .orderByRaw(`
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'warning'  THEN 2
            WHEN 'info'     THEN 3
            ELSE 4
          END,
          revenue_impact DESC NULLS LAST,
          created_at DESC
        `)
        .limit(limit)
        .select(
          'id',
          'alert_key',
          'source',
          'alert_type',
          'severity',
          'title',
          'message',
          'entity_id',
          'entity_type',
          'revenue_impact',
          'is_active',
          'dismissed_at',
          'resolved_at',
          'created_at',
          'updated_at'
        );

      if (activeOnly) {
        query.where({ is_active: true });
      }

      return query;
    });

    return res.status(200).json({
      data: alerts,
      meta: {
        total: alerts.length,
        active_only: activeOnly,
      },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ALERTS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch alerts: ${message}`,
    });
  }
};

/**
 * POST /api/v1/alerts/:alertId/dismiss
 * -------------------------------------
 * Operator dismisses an alert — sets dismissed_at.
 * Alert remains in DB for audit but excluded from active inbox.
 */
export const httpDismissAlert = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { alertId } = req.params;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const updated = await trx('alerts')
        .where({ id: alertId, shop_id: shopId })
        .update({
          dismissed_at: trx.fn.now(),
          is_active: false,
          updated_at: trx.fn.now(),
        });

      if (updated === 0) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      return res.status(200).json({ message: 'Alert dismissed' });
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ALERT_DISMISS_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to dismiss alert: ${message}`,
    });
  }
};