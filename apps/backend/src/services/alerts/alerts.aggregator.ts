// apps/backend/src/services/alerts/alerts.aggregator.ts
import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import { buildSlaBreachAlertCopy, buildBlockedRevenueAlertCopy } from './alerts.copy.js';
import { syncStockProtectionAlertsForShop } from './stockProtectionAlertSynchronizer.js';
import { readCurrentWaitingV1Records } from '../decision/interventionOutcome.service.js';
import { readCurrentFulfillmentSlaSummary } from '../orders/fulfillmentSla.service.js';
import { createNotificationsForAlertActivation } from '../notifications/notificationSourceAdapter.js';

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
 * - inventory_truth (low/out of stock, summed available_quantity per variant)
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

function alertWrite(trx: Knex.Transaction, alert: AlertUpsert) {
  return {
    ...alert,
    resolved_at: alert.is_active ? null : trx.fn.now(),
    updated_at:  trx.fn.now(),
  };
}

function alertRefresh(trx: Knex.Transaction, alert: AlertUpsert) {
  return {
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
  };
}

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
  alerts: AlertUpsert[],
): Promise<void> {
  if (alerts.length === 0) return;

  for (const alert of alerts) {
    if (!alert.is_active) {
      await trx('alerts')
        .insert(alertWrite(trx, alert))
        .onConflict(['shop_id', 'alert_key'])
        .merge(alertRefresh(trx, alert));
      continue;
    }

    const [inserted] = await trx('alerts')
      .insert(alertWrite(trx, alert))
      .onConflict(['shop_id', 'alert_key'])
      .ignore()
      .returning(['id']);

    if (inserted) {
      await createNotificationsForAlertActivation(trx, alert);
      continue;
    }

    const existing = await trx('alerts')
      .where({ shop_id: alert.shop_id, alert_key: alert.alert_key })
      .forUpdate()
      .first('is_active');

    const activated = existing && existing.is_active !== true;

    await trx('alerts')
      .where({ shop_id: alert.shop_id, alert_key: alert.alert_key })
      .update(alertRefresh(trx, alert));

    if (activated) {
      await createNotificationsForAlertActivation(trx, alert);
    }
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
  /**
   * WAITING V1 — per-episode NOW exclusion (OPS-CONSOLE-WAITING-01, corrections
   * 1 & 2).
   *
   * Only an exact CURRENT constraint episode with a valid-pairing, canonically
   * pending_verification intervention is excluded — never the whole
   * constraint_type aggregate, and never an episode whose only intervention
   * has an invalid treatment/constraint pairing (that episode stays fully
   * NOW-eligible). readCurrentWaitingV1Records() is the SAME shared seam
   * GET /api/v1/operations/waiting reads from — one shop-wide "current
   * WAITING" projection, two consumers, never two independent
   * interpretations of "waiting". It already collapses repeated
   * interventions against one still-active episode to a single winner, so
   * the resulting constraintIds are already unique.
   */
  const currentWaitingRecords = await readCurrentWaitingV1Records({ shopId }, trx);
  const excludedConstraintIds = currentWaitingRecords.map((record) => record.constraintId as string);

  const rows = await trx('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('oc.is_active', true)
    .where('o.shop_id', shopId)
    .modify((qb) => {
      if (excludedConstraintIds.length > 0) {
        qb.whereNotIn('oc.constraint_id', excludedConstraintIds);
      }
    })
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
   * CURRENT FULFILLMENT SLA TRUTH
   * -----------------------------
   * SLA alert state is time-driven. Read canonical current truth from order
   * timestamps + NOW() so idle orders cross the SLA boundary without waiting
   * for an order_age_snapshot projection event.
   *
   * The alert key/source/lifecycle contract remains unchanged here; this slice
   * replaces only the stale signal source.
   */
  const summary = await readCurrentFulfillmentSlaSummary(shopId, trx);
  const count = summary.breachedCount;

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

  const breachedOrderValue = summary.breachedRevenue;
  const slaCopy = buildSlaBreachAlertCopy(count, breachedOrderValue);

  return [{
    shop_id:        shopId,
    alert_key:      `sla:shop-${shopId}:shipping_breach`,
    source:         'snapshot',
    alert_type:     'sla_breach',
    severity:       'critical',
    title:          slaCopy.title,
    message:        slaCopy.message,
    entity_id:      null,
    entity_type:    'shop',
    revenue_impact: breachedOrderValue,
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

  // Resolution hint (carried in the message): resolving each order's constraint
  // (address, stock, payment) directly unblocks the revenue — owner needs to
  // know the action, not just the symptom. Title/message wording now owned by
  // buildBlockedRevenueAlertCopy.
  const blockedCopy = buildBlockedRevenueAlertCopy(constrained, blocked);

  return [{
    shop_id:        shopId,
    alert_key:      `revenue:shop-${shopId}:at_risk`,
    source:         'snapshot',
    alert_type:     'revenue_at_risk',
    severity:       blocked > 5000 ? 'critical' : 'warning',
    title:          blockedCopy.title,
    message:        blockedCopy.message,
    entity_id:      null,
    entity_type:    'shop',
    revenue_impact: blocked,
    is_active:      true,
    category:       'revenue_at_risk',
    audience:       'all',
  }];
}

/**
 * LOW STOCK / REORDER ALERT (FP-OV-10)
 * -------------------------------------
 * Surfaces when active variants have low or zero sellable availability,
 * summed across all locations (a variant can hold stock in multiple
 * bins — checking a single location undercounts true availability).
 * Category: stock_reorder — declared in the taxonomy but previously
 * unproduced by any aggregator; only fired reactively by the manual
 * resolve_inventory_block handler, never on a schedule.
 *
 * Threshold: <=3 available units, matching the existing client-side
 * "at risk" threshold in FloorPlanningModuleFT2.tsx's gridOccupancy
 * calculation (FP-SUMMARY1) — one fact source, one signal everywhere.
 * No per-shop configurable reorder point exists yet (audited, confirmed
 * absent); this is a shared hardcoded default until that's built.
 *
 * alert_type 'low_stock_reorder' is distinct from the manual handler's
 * 'stockout_risk' alert_type — different alert_key namespace, no
 * onConflict collision. This is a shop-level summary count, not
 * per-variant, matching the pattern of the other snapshot aggregators.
 */
async function aggregateStockReorderAlerts(
  trx: Knex.Transaction,
  shopId: number
): Promise<AlertUpsert[]> {
  const rows = await trx('inventory_truth as it')
    .join('variants as v', function () {
      this.on('v.lasyncro_variant_id', 'it.lasyncro_variant_id')
        .andOn('v.shop_id', 'it.shop_id');
    })
    .where('it.shop_id', shopId)
    .where('v.status', 'active')
    .groupBy('it.lasyncro_variant_id')
    .havingRaw('SUM(it.available_quantity) <= 3')
    .select(
      'it.lasyncro_variant_id',
      trx.raw('SUM(it.available_quantity) as available_quantity')
    );

  const count       = rows.length;
  const outOfStock  = rows.filter((r: any) => Number(r.available_quantity) <= 0).length;

  if (count === 0) {
    return [{
      shop_id:     shopId,
      alert_key:   `inventory:shop-${shopId}:low_stock`,
      source:      'snapshot',
      alert_type:  'low_stock_reorder',
      severity:    'warning',
      title:       'Stock levels healthy',
      message:     'No active products are low on stock.',
      entity_type: 'shop',
      is_active:   false,
      category:    'stock_reorder',
      audience:    'all',
    }];
  }

  return [{
    shop_id:        shopId,
    alert_key:      `inventory:shop-${shopId}:low_stock`,
    source:         'snapshot',
    alert_type:     'low_stock_reorder',
    severity:       outOfStock > 0 ? 'critical' : 'warning',
    title:          `${count} product${count > 1 ? 's' : ''} low on stock`,
    message: `${count} active product${count > 1 ? 's are' : ' is'} at or below reorder threshold${outOfStock > 0 ? `, ${outOfStock} completely out of stock` : ''} — reorder soon to avoid stockouts.`,
    entity_id:      null,
    entity_type:    'shop',
    revenue_impact: null,
    is_active:      true,
    category:       'stock_reorder',
    audience:       'all',
  }];
}

/**
 * MAIN AGGREGATOR ENTRY POINT
 * ---------------------------
 * Called after every snapshot recomputation.
 * Runs inside a transaction with app.current_tenant set.
 */
export async function aggregateAlertsForShopInTransaction(
  trx: Knex.Transaction,
  shopId: number,
): Promise<void> {
  await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

  const [constraintAlerts, slaAlerts, revenueAlerts, missingCogsAlerts] =
    await Promise.all([
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
  await syncStockProtectionAlertsForShop(trx, shopId);

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
    .whereIn('source', ['constraint', 'snapshot'])
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
}

export async function aggregateAlertsForShop(shopId: number): Promise<void> {
  await db.transaction(async (trx) => {
    await aggregateAlertsForShopInTransaction(trx, shopId);
  });
}
