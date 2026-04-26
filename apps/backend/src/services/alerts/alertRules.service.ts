// apps/backend/src/services/alerts/alertRules.service.ts
import type { Knex } from 'knex';

/**
 * ALERT RULES SERVICE (PP3-01, PP3-02)
 * -------------------------------------
 * Evaluates shop_alert_rules against a newly created order.
 * Called by the orders/create projection handler after order insert.
 *
 * Rules are evaluated in-process, synchronously, within the same
 * transaction as the order insert — guarantees atomicity.
 *
 * Alert key format: rule:{rule_id}:order:{lasyncro_order_id}
 * Idempotent — safe on projection replay.
 *
 * Supported rule types (v1):
 * - 'new_order'          — fires on every order
 * - 'order_from_region'  — fires when shipping_province matches config.province
 * - 'order_above_value'  — fires when total_price >= config.threshold
 */

type OrderContext = {
  lasyncroOrderId: string;
  shopId: number;
  totalPrice: number;
  shippingProvince: string | null;
  shippingCountryCode: string | null;
  externalOrderId?: string | null;
};

type AlertRule = {
  id: string;
  rule_type: string;
  config: Record<string, unknown>;
  push_enabled: boolean;
};

/**
 * Evaluates whether a rule matches the given order.
 */
function ruleMatches(rule: AlertRule, order: OrderContext): boolean {
  switch (rule.rule_type) {
    case 'new_order':
      return true;

    case 'order_from_region': {
      const province = (rule.config.province as string | undefined)?.toUpperCase();
      const country = (rule.config.country_code as string | undefined)?.toUpperCase();
      if (!province && !country) return false;
      const provinceMatch = province
        ? order.shippingProvince?.toUpperCase() === province
        : true;
      const countryMatch = country
        ? order.shippingCountryCode?.toUpperCase() === country
        : true;
      return provinceMatch && countryMatch;
    }

    case 'order_above_value': {
      const threshold = rule.config.threshold as number | undefined;
      if (threshold == null) return false;
      return order.totalPrice >= threshold;
    }

    default:
      return false;
  }
}

/**
 * Builds operator-facing alert title and message for a matched rule.
 */
function buildAlertContent(
  rule: AlertRule,
  order: OrderContext
): { title: string; message: string } {
  const orderRef = order.externalOrderId ? `#${order.externalOrderId}` : 'New order';

  switch (rule.rule_type) {
    case 'new_order':
      return {
        title: `${orderRef} received`,
        message: `A new order worth $${order.totalPrice.toFixed(2)} just came in.`,
      };

    case 'order_from_region':
      return {
        title: `${orderRef} from ${order.shippingProvince ?? order.shippingCountryCode}`,
        message: `New order from ${order.shippingProvince ?? order.shippingCountryCode} — $${order.totalPrice.toFixed(2)}.`,
      };

    case 'order_above_value':
      return {
        title: `${orderRef} — high value order`,
        message: `Order worth $${order.totalPrice.toFixed(2)} exceeded your threshold.`,
      };

    default:
      return {
        title: `${orderRef} matched alert rule`,
        message: `Order triggered a configured alert rule.`,
      };
  }
}

/**
 * Main entry point — called after order insert in orders.create projection.
 *
 * Fetches active rules for the shop, evaluates each, upserts matching alerts.
 * Non-blocking — errors are caught and logged, never thrown.
 */
export async function evaluateAlertRulesForOrder(
  trx: Knex.Transaction,
  order: OrderContext
): Promise<void> {
  try {
    const rules: AlertRule[] = await trx('shop_alert_rules')
      .where({ shop_id: order.shopId, is_active: true })
      .select('id', 'rule_type', 'config', 'push_enabled');

    if (rules.length === 0) return;

    for (const rule of rules) {
      if (!ruleMatches(rule, order)) continue;

      const { title, message } = buildAlertContent(rule, order);
      const alertKey = `rule:${rule.id}:order:${order.lasyncroOrderId}`;

      await trx('alerts')
        .insert({
          shop_id: order.shopId,
          alert_key: alertKey,
          source: 'rule',
          alert_type: rule.rule_type,
          severity: 'info',
          title,
          message,
          entity_id: order.lasyncroOrderId,
          entity_type: 'order',
          revenue_impact: order.totalPrice,
          is_active: true,
        })
        .onConflict(['shop_id', 'alert_key'])
        .ignore(); // Idempotent — replay safe

      console.info('[ALERT_RULE_FIRED]', {
        shopId: order.shopId,
        ruleId: rule.id,
        ruleType: rule.rule_type,
        orderId: order.lasyncroOrderId,
      });
    }
  } catch (err) {
    // Non-blocking — alert rule failure must never fail order ingestion
    console.error('[ALERT_RULES_EVALUATION_FAILED]', {
      shopId: order.shopId,
      orderId: order.lasyncroOrderId,
      error: (err as Error).message,
    });
  }
}