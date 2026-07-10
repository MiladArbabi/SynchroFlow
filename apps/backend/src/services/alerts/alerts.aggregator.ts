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
 * - order_revenue_units (missing COGS)
 *
 * RULES:
 * - Idempotent — upserts on (shop_id, alert_key)
 * - Operator vocabulary — never system language in title/message
 * - Revenue-ranked — higher impact alerts surface first
 * - Auto-resolves — inactive signals mark alerts resolved
 * - category + audience required on every alert (D1 consequence taxonomy)
 *
 * Called by:
 * - shopOperationalSnapshot.worker.ts after snapshot recompute
 */

/**
 * CONSEQUENCE TAXONOMY CATEGORIES (blueprint §6)
 * ------------------------------------------------
 * revenue_at_risk   : money leaving / customer breach imminent
 * stock_reorder     : stockout risk or reorder threshold crossed
 * money_margin      : margin erosion, missing cost data
 * supplier_inbound  : PO delays, fill/defect rate issues
 * warehouse_floor   : pick/pack exceptions, idle operators (operator audience)
 * data_trust        : sync staleness, identity map gaps, missing fields
 */
type AlertCategory =
  | 'revenue_at_risk'
  | 'stock_reorder'
  | 'money_margin'
  | 'supplier_inbound'
  | 'warehouse_floor'
  | 'data_trust';

type AlertAudience = 'operator' | 'owner' | 'all';

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
  category: AlertCategory;
  audience: AlertAudience;
};

/**
 * MISSING COGS ALERT (AL-06)
 * --------------------------
 * Surfaces when orders have line items with no estimated_unit_cost.
 * Without cost data, margin figures are incomplete and unreliable.
 * Category: data_trust — audience: owner (cost is owner/admin concern)
 */
async function aggregateMissingCogsAlerts(
  trx: Knex.Transaction,
  shopId: number
): Promise<AlertUpsert[]> {
  const row = await trx('order_revenue_units as oru')
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'oru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .where(function () {
      this.whereNull('oru.estimated_unit_cost')
        .orWhere('oru.estimated_unit_cost', '<=', 0);
    })
    .where('ofs.status', '!=', 'fulfilled')
    .countDistinct('oru.lasyncro_variant_id as variant_count')
    .countDistinct('oru.lasyncro_order_id as order_count')
    .first();

  const variantCount = Number(row?.variant_count ?? 0);
  const orderCount   = Number(row?.order_count ?? 0);

  if (variantCount === 0) {
    return [{
      shop_id:    shopId,
      alert_key:  `cogs:shop-${shopId}:missing_cost`,
      source:     'snapshot',
      alert_type: 'missing_cogs',
      severity:   'warning',
      title:      'All products have cost data',
      message:    'Margin figures are complete across all active orders.',
      entity_type: 'shop',
      is_active:  false,
      category:   'data_trust',
      audience:   'owner',
    }];
  }

  return [{
    shop_id:        shopId,
    alert_key:      `cogs:shop-${shopId}:missing_cost`,
    source:         'snapshot',
    alert_type:     'missing_cogs',
    severity:       'warning',
    title:          `${variantCount} product${variantCount > 1 ? 's' : ''} missing cost data`,
    message:        `${orderCount} active order${orderCount > 1 ? 's have' : ' has'} ${variantCount} product${variantCount > 1 ? 's' : ''} without cost data. Margin figures for these orders are incomplete.`,
    entity_id:      null,
    entity_type:    'shop',
    revenue_impact: null,
    is_active:      true,
    category:       'data_trust',
    audience:       'owner',
  }];
}

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
        updated_at:  trx.fn.now(),
      })
      .onConflict(['shop_id', 'alert_key'])
      .merge({
        severity:       alert.severity,
        title:          alert.title,
        message:        alert.message,
        is_active:      alert.is_active,
        revenue_impact: alert.revenue_impact ?? null,
        category:       alert.category,
        audience:       alert.audience,
        resolved_at:    alert.is_active ? null : trx.fn.now(),
        /**
         * DISMISS RESET ON REACTIVATION
         * ------------------------------
         * When a signal re-fires (is_active=true), clear dismissed_at so
         * the operator sees it again. When signal clears (is_active=false),
         * preserve dismissed_at for audit. Dismissing is always temporary —
         * if the underlying problem persists, the alert returns.
         */
        dismissed_at: alert.is_active
          ? null
          : trx.raw('"alerts"."dismissed_at"'),
        updated_at: trx.fn.now(),
      });
  }
}

/**
 * OPERATIONAL CONSTRAINT ALERTS
 * ------------------------------
 * One alert per active constraint type (not per order — too noisy).
 *
 * Category mapping (blueprint §6):
 *   operational → revenue_at_risk (overdue = money leaving)
 *   inventory   → stock_reorder   (can't ship = stock problem)
 *   customer    → revenue_at_risk (address block = breach imminent)
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
    const count   = Number(row.order_count);
    const revenue = Number(row.total_revenue ?? 0);

    type ConstraintConfig = {
      title: string;
      message: string;
      severity: 'critical' | 'warning';
      category: AlertCategory;
    };

    const typeMap: Record<string, ConstraintConfig> = {
      operational: {
        title:    `${count} order${count > 1 ? 's' : ''} blocked at fulfillment`,
        message:  `${count} order${count > 1 ? 's have' : ' has'} an unresolved pick exception (item missing, short pick, or defect) stopping fulfillment.`,
        severity: 'critical',
        category: 'revenue_at_risk',
      },
      inventory: {
        title:    `${count} order${count > 1 ? 's' : ''} out of stock`,
        message:  `${count} order${count > 1 ? 's' : ''} cannot ship due to missing inventory.`,
        severity: 'warning',
        category: 'stock_reorder',
      },
      customer: {
        title:    `${count} order${count > 1 ? 's' : ''} with address issues`,
        message:  `${count} order${count > 1 ? 's have' : ' has'} a customer address problem blocking fulfillment.`,
        severity: 'warning',
        category: 'revenue_at_risk',
      },
    };

    const config = typeMap[row.constraint_type] ?? {
      title:    `${count} blocked orders`,
      message:  `${count} orders have an unresolved constraint.`,
      severity: 'warning' as const,
      category: 'revenue_at_risk' as AlertCategory,
    };

    return {
      shop_id:        shopId,
      alert_key:      `constraint:shop-${shopId}:${row.constraint_type}`,
      source:         'constraint',
      alert_type:     row.constraint_type,
      severity:       config.severity,
      title:          config.title,
      message:        config.message,
      entity_id:      null,
      entity_type:    'shop',
      revenue_impact: revenue,
      is_active:      true,
      category:       config.category,
      audience:       'all' as AlertAudience,
    };
  });
}

/**
 * SLA BREACH ALERTS
 * -----------------
 * Aggregate SLA breaches into a single shop-level alert.
 * Category: revenue_at_risk — SLA breach = customer complaint imminent.
 */
async function aggregateSlaAlerts(
  trx: Knex.Transaction,
  shopId: number
): Promise<AlertUpsert[]> {
  /**
   * SHIPPING SLA BREACH COUNT (deterministic, version-safe)
   * -------------------------------------------------------
   * order_age_snapshot is versioned by aggregate_version — every rebuild/
   * reconciliation appends a new row per order. Counting raw rows inflates
   * the breach total (e.g. 18 orders × N versions = 59). We therefore:
   *   1. Filter to the LATEST aggregate_version per order (correlated subquery,
   *      matching OrdersOperatorFacts house pattern).
   *   2. EXCLUDE fulfilled orders — a shipped order cannot breach a *shipping*
   *      SLA, so fulfilled rows must never count even if the flag is stale.
   *   3. COUNT DISTINCT orders (not rows) and sum revenue once per order.
   */
  const row = await trx('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .where('oas.is_shipping_sla_breached', true)
    .andWhere(function () {
      // Unfulfilled only: status is null or anything other than 'fulfilled'
      this.whereNull('ofs.status').orWhereNot('ofs.status', 'fulfilled');
    })
    // Latest snapshot version per order — avoids version multiplication
    .andWhere(
      'oas.aggregate_version',
      db('order_age_snapshot as oas2')
        .where('oas2.lasyncro_order_id', db.raw('oas.lasyncro_order_id'))
        .max('oas2.aggregate_version')
    )
    .countDistinct('o.lasyncro_order_id as breach_count')
    .sum('o.total_price as total_revenue')
    .first();

  const count = Number(row?.breach_count ?? 0);

  if (count === 0) {
    return [{
      shop_id:     shopId,
      alert_key:   `sla:shop-${shopId}:shipping_breach`,
      source:      'snapshot',
      alert_type:  'sla_breach',
      severity:    'critical',
      title:       'SLA breach resolved',
      message:     'All orders are within SLA.',
      entity_type: 'shop',
      is_active:   false,
      category:    'revenue_at_risk',
      audience:    'all',
    }];
  }

  return [{
    shop_id:        shopId,
    alert_key:      `sla:shop-${shopId}:shipping_breach`,
    source:         'snapshot',
    alert_type:     'sla_breach',
    severity:       'critical',
    title:          `${count} order${count > 1 ? 's' : ''} past shipping SLA`,
    // Resolution hint: tells owner the job-to-be-done, not just the problem.
    // "Fulfil these orders" is the one action that clears this alert.
    message: `${count} order${count > 1 ? 's have' : ' has'} breached the shipping SLA — fulfil ${count > 1 ? 'them' : 'it'} now to prevent customer complaints.`,
    entity_id:      null,
    entity_type:    'shop',
    revenue_impact: Number(row?.total_revenue ?? 0),
    is_active:      true,
    category:       'revenue_at_risk',
    audience:       'all',
  }];
}

/**
 * REVENUE AT RISK ALERT
 * ---------------------
 * Surfaces when significant revenue is blocked by constraints.
 * Category: revenue_at_risk — direct commercial consequence signal.
 */
async function aggregateRevenueAlerts(
  trx: Knex.Transaction,
  shopId: number
): Promise<AlertUpsert[]> {
  // ISS-055 fix #2: this alert's own contract is "revenue blocked by
  // constraints" (see doc comment above) — it must pair constrained_orders
  // with blocked_revenue, not at_risk_revenue. at_risk_revenue is a
  // different, unrelated population (orders approaching SLA breach that
  // have NOT breached yet) and does not describe the same orders as
  // constrained_orders. The two were previously conflated into one
  // sentence that stated a false causal relationship.
  const snapshot = await systemQuery(
    trx('orders_operational_control_snapshot')
      .where({ shop_id: shopId })
      .orderBy([
        { column: 'snapshot_date',      order: 'desc' },
        { column: 'aggregate_version',  order: 'desc' },
      ])
      .select('blocked_revenue', 'constrained_orders')
      .first()
  );
  const blocked      = Number(snapshot?.blocked_revenue ?? 0);
  const constrained  = Number(snapshot?.constrained_orders ?? 0);

  if (blocked < 100 || constrained === 0) {
    return [{
      shop_id:     shopId,
      alert_key:   `revenue:shop-${shopId}:at_risk`,
      source:      'snapshot',
      alert_type:  'revenue_at_risk',
      severity:    'warning',
      title:       'Revenue on track',
      message:     'No significant revenue is currently at risk.',
      entity_type: 'shop',
      is_active:   false,
      category:    'revenue_at_risk',
      audience:    'all',
    }];
  }

  return [{
    shop_id:        shopId,
    alert_key:      `revenue:shop-${shopId}:at_risk`,
    source:         'snapshot',
    alert_type:     'revenue_at_risk',
    severity:       blocked > 5000 ? 'critical' : 'warning',
    title:          `$${Math.round(blocked).toLocaleString()} revenue blocked`,
    // Resolution hint: resolving each order's constraint (address, stock, payment)
    // directly unblocks the revenue — owner needs to know the action, not just the symptom.
    message: `${constrained} constrained order${constrained > 1 ? 's are' : ' is'} blocking $${Math.round(blocked).toLocaleString()} in revenue — resolve each constraint to release it.`,
    entity_id:      null,
    entity_type:    'shop',
    revenue_impact: blocked,
    is_active:      true,
    category:       'revenue_at_risk',
    audience:       'all',
  }];
}

/**
 * MAIN AGGREGATOR ENTRY POINT
 * ---------------------------
 * Called after every snapshot recomputation.
 * Runs inside a transaction with app.current_tenant set.
 */
export async function aggregateAlertsForShop(shopId: number): Promise<void> {
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const [constraintAlerts, slaAlerts, revenueAlerts, missingCogsAlerts] = await Promise.all([
      aggregateConstraintAlerts(trx, shopId),
      aggregateSlaAlerts(trx, shopId),
      aggregateRevenueAlerts(trx, shopId),
      aggregateMissingCogsAlerts(trx, shopId),
    ]);

    const allAlerts = [
      ...constraintAlerts,
      ...slaAlerts,
      ...revenueAlerts,
      ...missingCogsAlerts,
    ];

    await upsertAlerts(trx, allAlerts);

    /**
     * RECONCILE — DEACTIVATE ORPHANED ALERTS
     * --------------------------------------
     * upsertAlerts only writes the alerts that are produced THIS run. An
     * alert whose underlying signal has cleared (e.g. operational
     * constraints that no longer exist after a projection change) is never
     * re-emitted, so without this step it would linger is_active=true
     * forever. Here we deactivate any currently-active alert for this shop
     * whose alert_key is NOT in the freshly-computed set. We preserve
     * dismissed_at (audit) and stamp resolved_at, matching upsertAlerts.
     *
     * If allAlerts is empty, every active alert for the shop is cleared.
     */
    const activeKeys = allAlerts
      .filter(a => a.is_active)
      .map(a => a.alert_key);
    const deactivateQuery = trx('alerts')
      .where({ shop_id: shopId, is_active: true })
      .update({
        is_active:   false,
        resolved_at: trx.fn.now(),
        updated_at:  trx.fn.now(),
      });
    if (activeKeys.length > 0) {
      deactivateQuery.whereNotIn('alert_key', activeKeys);
    }
    const deactivatedCount = await deactivateQuery;

    console.info('[ALERTS_AGGREGATED]', {
      shopId,
      total:        allAlerts.length,
      active:       allAlerts.filter(a => a.is_active).length,
      deactivated:  deactivatedCount,
    });
  });
}