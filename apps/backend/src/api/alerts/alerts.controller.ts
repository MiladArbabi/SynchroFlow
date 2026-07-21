// apps/backend/src/api/alerts/alerts.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * ALERTS CONTROLLER
 * -----------------
 * Endpoints:
 *   GET  /api/v1/alerts                  — ranked inbox, tab-aware
 *   POST /api/v1/alerts/:id/acknowledge  — operator marks seen (stays in Inbox, muted)
 *   POST /api/v1/alerts/:id/snooze       — park until { until: ISO } timestamp
 *   POST /api/v1/alerts/:id/resolve      — owner/admin manual resolve
 *   POST /api/v1/alerts/:id/dismiss      — DEPRECATED 410; use acknowledge
 *
 * Tab → query mapping:
 *   inbox    (default) : is_active=true AND (snoozed_until IS NULL OR snoozed_until <= now())
 *   snoozed            : is_active=true AND snoozed_until > now()
 *   resolved           : resolved_at IS NOT NULL
 */

const ALERT_SELECT = [
  'id', 'alert_key', 'source', 'alert_type', 'severity',
  'title', 'message', 'entity_id', 'entity_type', 'revenue_impact',
  'category', 'audience',
  'is_active', 'dismissed_at', 'resolved_at',
  'acknowledged_at', 'acknowledged_by', 'snoozed_until',
  'escalated_at', 'rule_id',
  'created_at', 'updated_at',
] as const;

// ─── GET /api/v1/alerts ────────────────────────────────────────────────────

export const httpGetAlerts = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const status = (req.query.status as string) ?? 'inbox';
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 50));
    const alertType = req.query.alert_type as string | undefined;
    const alerts = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const q = trx('alerts')
        .where({ shop_id: shopId })
        .modify((qb) => {
          if (alertType) qb.where({ alert_type: alertType });
        })
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
        .select(...ALERT_SELECT);

      // Tab-aware filtering — mirrors ModuleTabBar tabs
      if (status === 'snoozed') {
        q.where({ is_active: true })
         .whereNotNull('snoozed_until')
         .whereRaw('snoozed_until > now()');
      } else if (status === 'resolved') {
        q.whereNotNull('resolved_at');
      } else {
        // inbox: active, not currently snoozed
        q.where({ is_active: true })
         .whereRaw('(snoozed_until IS NULL OR snoozed_until <= now())');
      }

      /**
       * AUDIENCE FILTER
       * ---------------
       * Operators only see warehouse_floor alerts — they have no lever
       * to pull on revenue, margin, stock, or supplier intelligence.
       * owner/admin see all audiences.
       * Enforced server-side — not bypassable via client filters.
       */
      const rolesRaw = req.user?.roles ?? [];
      const roles    = Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw];
      const isOperator = !roles.includes('owner') && !roles.includes('admin');
      if (isOperator) {
        q.where(function () {
          this.where({ audience: 'operator' }).orWhere({ audience: 'all' });
        });
      }

      return q;
    });

    return res.status(200).json({
      data: alerts,
      meta: { total: alerts.length, status },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ALERTS_FETCH_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch alerts: ${message}` });
  }
};

// ─── POST /api/v1/alerts/:id/acknowledge ──────────────────────────────────

export const httpAcknowledgeAlert = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    const userId = req.user?.userId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const { alertId } = req.params;

    let notFound = false;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const updated = await trx('alerts')
        .where({ id: alertId, shop_id: shopId })
        .whereNull('acknowledged_at')
        .update({
          acknowledged_at: trx.fn.now(),
          acknowledged_by: userId ?? null,
          updated_at:      trx.fn.now(),
        });

      if (updated === 0) {
        const exists = await trx('alerts')
          .where({ id: alertId, shop_id: shopId })
          .first('id');
        if (!exists) notFound = true;
      }
    });

    if (notFound) return res.status(404).json({ error: 'Alert not found' });
    return res.status(200).json({ message: 'Alert acknowledged' });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ALERT_ACKNOWLEDGE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to acknowledge alert: ${message}` });
  }
};

// ─── POST /api/v1/alerts/:id/snooze ───────────────────────────────────────

export const httpSnoozeAlert = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const { alertId } = req.params;
    const { until } = req.body as { until?: string };

    if (!until || isNaN(Date.parse(until))) {
      return res.status(400).json({ error: '`until` must be a valid ISO timestamp' });
    }

    const snoozeUntil = new Date(until);
    if (snoozeUntil <= new Date()) {
      return res.status(400).json({ error: '`until` must be in the future' });
    }

    let notFound = false;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const updated = await trx('alerts')
        .where({ id: alertId, shop_id: shopId })
        .update({
          snoozed_until: snoozeUntil,
          updated_at:    trx.fn.now(),
        });

      if (updated === 0) notFound = true;
    });

    if (notFound) return res.status(404).json({ error: 'Alert not found' });
    return res.status(200).json({ message: 'Alert snoozed', until });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ALERT_SNOOZE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to snooze alert: ${message}` });
  }
};

// ─── POST /api/v1/alerts/:id/resolve ──────────────────────────────────────

export const httpResolveAlert = async (req: Request, res: Response) => {
  try {
    const shopId  = req.user?.shopId;
    const roles   = req.user?.roles ?? [];
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    // Manual resolve is owner/admin only — operators use acknowledge
    const canResolve = roles.includes('owner') || roles.includes('admin');
    if (!canResolve) {
      return res.status(403).json({ error: 'Only owners and admins can manually resolve alerts' });
    }

    const { alertId } = req.params;

    let notFound = false;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const updated = await trx('alerts')
        .where({ id: alertId, shop_id: shopId })
        .update({
          resolved_at: trx.fn.now(),
          is_active:   false,
          updated_at:  trx.fn.now(),
        });

      if (updated === 0) notFound = true;
    });

    if (notFound) return res.status(404).json({ error: 'Alert not found' });
    return res.status(200).json({ message: 'Alert resolved' });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ALERT_RESOLVE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to resolve alert: ${message}` });
  }
};

// ─── POST /api/v1/alerts/:id/dismiss — DEPRECATED ─────────────────────────

/**
 * DEPRECATED — B-05 / KI-2
 * -------------------------
 * dismiss set is_active=false but the aggregator re-upserted is_active=true
 * on every snapshot cycle, making dismissed alerts silently reappear.
 * Replaced by acknowledge (operator) + auto-resolve (system) + resolve (owner).
 * Returns 410 Gone to surface the deprecation clearly on any stale callers.
 */
export const httpDismissAlert = async (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'dismiss is retired — use POST /:id/acknowledge or /:id/resolve',
  });
};