// apps/backend/src/services/alerts/alerts.aggregator.ts

import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

/**
 * ALERTS AGGREGATOR SERVICE (AL-01)
 * ----------------------------------
 * Reads from canonical signal sources and upserts into `alerts`.
 *
 * Signal sources:
 * - order_constraints (operational, inventory, customer blocks)
 * - order_age_snapshot (SLA breaches)
 * - orders_operational_control_snapshot (revenue at risk)
 *
 * RULES:
 * - Idempotent — upserts on (shop_id, alert_key)
 * - Operator vocabulary — never system language in title/message
 * - Revenue-ranked — higher impact alerts surface first
 * - Auto-resolves — inactive signals mark alerts resolved
 *
 * Called by:
 * - shopOperationalSnapshot.worker.ts after snapshot recompute
 */

type AlertUpsert = {
  shop_id: number;
  alert_key: string;
  source: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  entity_id?: string | null;
  entity_type?: string | null;
  revenue_impact?: number | null;
  is_active: boolean;
};

async function upsertAlerts(
  trx: Knex.Transaction,
  alerts: AlertUpsert[]
): Promise<void> {
  if (alerts.length === 0) return;

  for (const alert of alerts) {
    await trx('alerts')
      .insert({
        ...alert,
        resolved_at: alert.is_active ? null : trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .onConflict(['shop_id', 'alert_key'])
      // AFTER
      .merge({
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        is_active: alert.is_active,
        revenue_impact: alert.revenue_impact ?? null,
        resolved_at: alert.is_active ? null : trx.fn.now(),
        /**
         * DISMISS RESET ON REACTIVATION
         * ------------------------------
         * When a signal re-fires (is_active = true), clear dismissed_at
         * so the operator sees the alert again in their inbox.
         *
         * When a signal clears (is_active = false), preserve dismissed_at
         * for audit purposes.
         *
         * This means: dismissing is temporary — if the problem
         * persists through the next snapshot cycle, the alert returns.
         * Operators must resolve the underlying issue to silence alerts.
         */
        dismissed_at: alert.is_active ? null : trx.raw('dismissed_at'),
        updated_at: trx.fn.now(),
      });
  }
}

/**
 * OPERATIONAL CONSTRAINT ALERTS
 * ------------------------------
 * One alert per active operational constraint order.
 * Groups by constraint type — not per-order (too noisy).
 */
async function aggregateConstraintAlerts(
  trx: Knex.Transaction,
  shopId: number
): Promise<AlertUpsert[]> {
  const rows = await trx('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('oc.is_active', true)
    .where('o.shop_id', shopId)
    .groupBy('oc.constraint_type')
    .select(
      'oc.constraint_type',
      trx.raw('COUNT(*) as order_count'),
      trx.raw('SUM(o.total_price) as total_revenue')
    );

  return rows.map((row: any) => {
    const count = Number(row.order_count);
    const revenue = Number(row.total_revenue ?? 0);

    const typeMap: Record<string, { title: string; message: string; severity: 'critical' | 'warning' }> = {
      operational: {
        title: `${count} order${count > 1 ? 's' : ''} overdue`,
        message: `${count} paid order${count > 1 ? 's are' : ' is'} past SLA and need${count === 1 ? 's' : ''} immediate action.`,
        severity: 'critical',
      },
      inventory: {
        title: `${count} order${count > 1 ? 's' : ''} out of stock`,
        message: `${count} order${count > 1 ? 's' : ''} cannot ship due to missing inventory.`,
        severity: 'warning',
      },
      customer: {
        title: `${count} order${count > 1 ? 's' : ''} with address issues`,
        message: `${count} order${count > 1 ? 's have' : ' has'} a customer address problem blocking fulfillment.`,
        severity: 'warning',
      },
    };

    const config = typeMap[row.constraint_type] ?? {
      title: `${count} blocked orders`,
      message: `${count} orders have an unresolved constraint.`,
      severity: 'warning' as const,
    };

    return {
      shop_id: shopId,
      alert_key: `constraint:shop-${shopId}:${row.constraint_type}`,
      source: 'constraint',
      alert_type: row.constraint_type,
      severity: config.severity,
      title: config.title,
      message: config.message,
      entity_id: null,
      entity_type: 'shop',
      revenue_impact: revenue,
      is_active: true,
    };
  });
}

/**
 * SLA BREACH ALERTS
 * -----------------
 * Aggregate SLA breaches into a single shop-level alert.
 */
async function aggregateSlaAlerts(
  trx: Knex.Transaction,
  shopId: number
): Promise<AlertUpsert[]> {
  const row = await trx('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .where('oas.is_shipping_sla_breached', true)
    .count('oas.lasyncro_order_id as breach_count')
    .sum('o.total_price as total_revenue')
    .first();

  const count = Number(row?.breach_count ?? 0);
  if (count === 0) {
    return [{
      shop_id: shopId,
      alert_key: `sla:shop-${shopId}:shipping_breach`,
      source: 'snapshot',
      alert_type: 'sla_breach',
      severity: 'critical',
      title: 'SLA breach resolved',
      message: 'All orders are within SLA.',
      entity_type: 'shop',
      is_active: false,
    }];
  }

  return [{
    shop_id: shopId,
    alert_key: `sla:shop-${shopId}:shipping_breach`,
    source: 'snapshot',
    alert_type: 'sla_breach',
    severity: 'critical',
    title: `${count} order${count > 1 ? 's' : ''} past shipping SLA`,
    message: `${count} order${count > 1 ? 's have' : ' has'} breached the shipping SLA window and ${count > 1 ? 'are' : 'is'} at risk of customer complaints.`,
    entity_id: null,
    entity_type: 'shop',
    revenue_impact: Number(row?.total_revenue ?? 0),
    is_active: true,
  }];
}

/**
 * REVENUE AT RISK ALERT
 * ---------------------
 * Surfaces when significant revenue is blocked by constraints.
 */
async function aggregateRevenueAlerts(
  trx: Knex.Transaction,
  shopId: number
): Promise<AlertUpsert[]> {
  const snapshot = await systemQuery(
    trx('orders_operational_control_snapshot')
      .where({ shop_id: shopId })
      .orderBy([
        { column: 'snapshot_date', order: 'desc' },
        { column: 'aggregate_version', order: 'desc' },
      ])
      .select('at_risk_revenue', 'constrained_orders')
      .first()
  );

  const atRisk = Number(snapshot?.at_risk_revenue ?? 0);
  const constrained = Number(snapshot?.constrained_orders ?? 0);

  if (atRisk < 100 || constrained === 0) {
    return [{
      shop_id: shopId,
      alert_key: `revenue:shop-${shopId}:at_risk`,
      source: 'snapshot',
      alert_type: 'revenue_at_risk',
      severity: 'warning',
      title: 'Revenue on track',
      message: 'No significant revenue is currently at risk.',
      entity_type: 'shop',
      is_active: false,
    }];
  }

  return [{
    shop_id: shopId,
    alert_key: `revenue:shop-${shopId}:at_risk`,
    source: 'snapshot',
    alert_type: 'revenue_at_risk',
    severity: atRisk > 5000 ? 'critical' : 'warning',
    title: `$${Math.round(atRisk).toLocaleString()} revenue at risk`,
    message: `${constrained} constrained order${constrained > 1 ? 's are' : ' is'} blocking $${Math.round(atRisk).toLocaleString()} in revenue.`,
    entity_id: null,
    entity_type: 'shop',
    revenue_impact: atRisk,
    is_active: true,
  }];
}

/**
 * MAIN AGGREGATOR ENTRY POINT
 * ---------------------------
 * Called after every snapshot recomputation.
 * Runs inside a transaction with app.current_tenant set.
 */
export async function aggregateAlertsForShop(
  shopId: number
): Promise<void> {
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const [constraintAlerts, slaAlerts, revenueAlerts] = await Promise.all([
      aggregateConstraintAlerts(trx, shopId),
      aggregateSlaAlerts(trx, shopId),
      aggregateRevenueAlerts(trx, shopId),
    ]);

    const allAlerts = [
      ...constraintAlerts,
      ...slaAlerts,
      ...revenueAlerts,
    ];

    await upsertAlerts(trx, allAlerts);

    console.info('[ALERTS_AGGREGATED]', {
      shopId,
      total: allAlerts.length,
      active: allAlerts.filter(a => a.is_active).length,
    });
  });
}