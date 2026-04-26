// apps/backend/src/api/alerts/alertRules.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * ALERT RULES API (PP3-01)
 * ------------------------
 * CRUD for shop_alert_rules.
 *
 * Supported rule_type values (v1):
 * - 'new_order'          — every new order
 * - 'order_from_region'  — config: { province?, country_code? }
 * - 'order_above_value'  — config: { threshold: number }
 */

const VALID_RULE_TYPES = ['new_order', 'order_from_region', 'order_above_value'] as const;

// ─────────────────────────────────────────
// GET /api/v1/alert-rules
// ─────────────────────────────────────────
export const httpGetAlertRules = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const rules = await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    return trx('shop_alert_rules')
      .where({ shop_id: shopId })
      .orderBy('created_at', 'asc')
      .select('id', 'rule_type', 'config', 'push_enabled', 'is_active', 'created_at');
  });

  return res.json({ rules });
};

// ─────────────────────────────────────────
// POST /api/v1/alert-rules
// ─────────────────────────────────────────
export const httpCreateAlertRule = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { rule_type, config = {}, push_enabled = false } = req.body;

  if (!VALID_RULE_TYPES.includes(rule_type)) {
    return res.status(400).json({
      error: `Invalid rule_type. Must be one of: ${VALID_RULE_TYPES.join(', ')}`,
    });
  }

  // Validate config per rule type
  if (rule_type === 'order_from_region' && !config.province && !config.country_code) {
    return res.status(400).json({
      error: 'order_from_region requires config.province or config.country_code',
    });
  }
  if (rule_type === 'order_above_value' && (config.threshold == null || config.threshold <= 0)) {
    return res.status(400).json({
      error: 'order_above_value requires config.threshold > 0',
    });
  }

  const rule = await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    const [row] = await trx('shop_alert_rules')
      .insert({
        shop_id: shopId,
        rule_type,
        config,
        push_enabled,
        is_active: true,
      })
      .returning(['id', 'rule_type', 'config', 'push_enabled', 'is_active', 'created_at']);
    return row;
  });

  console.info('[ALERT_RULE_CREATED]', { shopId, rule_type, ruleId: rule.id });
  return res.status(201).json({ rule });
};

// ─────────────────────────────────────────
// DELETE /api/v1/alert-rules/:ruleId
// ─────────────────────────────────────────
export const httpDeleteAlertRule = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { ruleId } = req.params;

  const deleted = await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    return trx('shop_alert_rules')
      .where({ id: ruleId, shop_id: shopId })
      .delete() as unknown as Promise<number>;
  });

  if ((deleted as number) === 0) return res.status(404).json({ error: 'Rule not found' });

  console.info('[ALERT_RULE_DELETED]', { shopId, ruleId });
  return res.json({ success: true });
};