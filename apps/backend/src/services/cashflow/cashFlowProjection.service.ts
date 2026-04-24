// apps/backend/src/services/cashflow/cashFlowProjection.service.ts

import db from '@lasyncro/backend-core/db.js';

/**
 * CASH FLOW PROJECTION SERVICE (CF-01)
 * -------------------------------------
 * Computes a 30/60/90 day cash position for SMB operators.
 *
 * SOURCES:
 * - order_revenue_units + order_fulfillment_status → pending/realized revenue
 * - refund_executions → cash outflows
 * - inventory_truth + variants → working capital tied in stock
 * - orders_operational_control_snapshot → at-risk revenue
 * - order_constraints → blocked revenue by constraint type
 *
 * CASH FLOW BUCKETS:
 * - Realized: fulfilled orders (cash received)
 * - Pending: unfulfilled paid orders (cash expected)
 * - At Risk: constrained orders (cash uncertain)
 * - Refunded: cash returned to customers
 * - Inventory Value: capital tied in stock
 *
 * RULES:
 * - Read-only — never writes to projection tables
 * - Shop-scoped — always filters by shop_id
 * - Computed on demand — not cached (snapshot handles caching)
 */

export type CashFlowSummary = {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  total_refunded: number;
  inventory_value: number;
  net_cash_position: number;
  working_capital_locked: number;
};

export type CashFlowBucket = {
  label: string;
  orders: number;
  revenue: number;
  description: string;
};

export type CashFlowByConstraint = {
  constraint_type: string;
  orders: number;
  revenue_blocked: number;
};

export type PoOutflow = {
  supplier_name: string;
  po_id: string;
  expected_delivery_date: string | null;
  total_cost: number;
  status: string;
};

export type ProjectionPoint = {
  /** ISO date string for week start */
  week: string;
  /** Projected cumulative cash change from today */
  conservative: number;
  base: number;
  optimistic: number;
};

export type GrossProfit = {
  gross_revenue: number;
  total_cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
};

export type CashFlowProjectionResult = {
  summary: CashFlowSummary;
  gross_profit: GrossProfit;
  buckets: CashFlowBucket[];
  by_constraint: CashFlowByConstraint[];
  po_outflows: PoOutflow[];
  projection_60d: ProjectionPoint[];
  computed_at: string;
};

export async function computeCashFlowProjection(
  shopId: number
): Promise<CashFlowProjectionResult> {
  
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    /**
     * REALIZED REVENUE
     * ----------------
     * Fulfilled orders — cash already received.
     */
    const realizedRow = await trx('order_fulfillment_status as ofs')
      .join('order_revenue_units as oru', 'oru.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .where('ofs.status', 'fulfilled')
      .select(
        trx.raw('COUNT(DISTINCT ofs.lasyncro_order_id) as order_count'),
        trx.raw('COALESCE(SUM(oru.line_total), 0) as revenue'),
      )
      .first();

    /**
     * PENDING REVENUE
     * ---------------
     * Paid but unfulfilled orders — cash expected.
     */
    const pendingRow = await trx('order_fulfillment_status as ofs')
      .join('order_revenue_units as oru', 'oru.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .whereIn('ofs.status', ['pending', 'partially_fulfilled'])
      .select(
        trx.raw('COUNT(DISTINCT ofs.lasyncro_order_id) as order_count'),
        trx.raw('COALESCE(SUM(oru.line_total), 0) as revenue'),
      )
      .first();

    /**
     * AT RISK REVENUE
     * ---------------
     * Constrained orders — cash uncertain.
     */
    const atRiskRow = await trx('order_constraints as oc')
      .join('order_revenue_units as oru', 'oru.lasyncro_order_id', 'oc.lasyncro_order_id')
      .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .where('oc.is_active', true)
      .select(
        trx.raw('COUNT(DISTINCT oc.lasyncro_order_id) as order_count'),
        trx.raw('COALESCE(SUM(oru.line_total), 0) as revenue'),
      )
      .first();

    /**
     * TOTAL REFUNDED
     * --------------
     * Cash returned to customers.
     */
    const refundRow = await trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .select(
        trx.raw('COUNT(*) as refund_count'),
        trx.raw('COALESCE(SUM(re.total_refund_amount), 0) as total_refunded'),
      )
      .first();

    /**
     * INVENTORY VALUE
     * ---------------
     * Capital tied in stock = available_quantity × unit_cost.
     * Only counts variants with cost data.
     */
    const inventoryRow = await trx('inventory_truth as it')
      .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
      .where('it.shop_id', shopId)
      .where('it.available_quantity', '>', 0)
      .whereNotNull('v.unit_cost')
      .where('v.unit_cost', '>', 0)
      .select(
        trx.raw('COALESCE(SUM(it.available_quantity * v.unit_cost), 0) as inventory_value'),
      )
      .first();

    /**
     * BLOCKED REVENUE BY CONSTRAINT TYPE
     * ------------------------------------
     */
    const constraintRows = await trx('order_constraints as oc')
      .join('order_revenue_units as oru', 'oru.lasyncro_order_id', 'oc.lasyncro_order_id')
      .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .where('oc.is_active', true)
      .groupBy('oc.constraint_type')
      .select(
        'oc.constraint_type',
        trx.raw('COUNT(DISTINCT oc.lasyncro_order_id) as order_count'),
        trx.raw('COALESCE(SUM(oru.line_total), 0) as revenue_blocked'),
      );
    
    /**
     * COGS — cost of goods sold on fulfilled orders
     * Gross profit = realized revenue - COGS
     */
    const cogsRow = await trx('order_fulfillment_status as ofs')
      .join('order_revenue_units as oru', 'oru.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .where('ofs.status', 'fulfilled')
      .select(
        trx.raw('COALESCE(SUM(oru.estimated_unit_cost * oru.quantity), 0) as total_cogs'),
        trx.raw('COALESCE(SUM(oru.line_total), 0) as gross_revenue'),
      )
      .first();

    /**
     * PO OUTFLOWS — committed purchase orders not yet received
     * Shows upcoming cash commitments by supplier + expected date
     */
    const poOutflowRows = await trx('purchase_orders as po')
      .join('suppliers as s', 's.id', 'po.supplier_id')
      .leftJoin('purchase_order_line_items as li', function () {
        this.on('li.po_id', 'po.id').andOn('li.shop_id', trx.raw('?', [shopId]));
      })
      .where('po.shop_id', shopId)
      .whereNotIn('po.status', ['received', 'cancelled'])
      .groupBy('po.id', 's.name', 'po.expected_delivery_date', 'po.status')
      .orderBy('po.expected_delivery_date', 'asc')
      .select(
        'po.id as po_id',
        's.name as supplier_name',
        'po.expected_delivery_date',
        'po.status',
        trx.raw('COALESCE(SUM(li.quantity_ordered * li.unit_cost_cents / 100.0), 0) as total_cost'),
      );

    /**
     * VELOCITY — avg daily revenue over past 30 days for projection
     */
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const velocityRow = await trx('order_fulfillment_status as ofs')
      .join('order_revenue_units as oru', 'oru.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .where('ofs.status', 'fulfilled')
      .where('o.order_created_at', '>=', thirtyDaysAgo)
      .select(trx.raw('COALESCE(SUM(oru.line_total), 0) as revenue_30d'))
      .first();

    const realizedRevenue = Number(realizedRow?.revenue ?? 0);
    const pendingRevenue = Number(pendingRow?.revenue ?? 0);
    const atRiskRevenue = Number(atRiskRow?.revenue ?? 0);
    const totalRefunded = Number(refundRow?.total_refunded ?? 0);
    const inventoryValue = Number(inventoryRow?.inventory_value ?? 0);

    /**
     * NET CASH POSITION
     * -----------------
     * Realized - Refunded = actual cash received
     * Working capital = inventory value + pending revenue
     */
    const netCashPosition = realizedRevenue - totalRefunded;
    const workingCapitalLocked = inventoryValue + pendingRevenue;

    // Gross profit
    const grossRevenue = Number(cogsRow?.gross_revenue ?? 0);
    const totalCogs = Number(cogsRow?.total_cogs ?? 0);
    const grossProfit = grossRevenue - totalCogs;
    const grossMarginPct = grossRevenue > 0 ? Math.round((grossProfit / grossRevenue) * 10000) / 100 : null;

    // Daily revenue velocity
    const dailyVelocity = Number(velocityRow?.revenue_30d ?? 0) / 30;
    const weeklyVelocity = dailyVelocity * 7;

    // PO outflows map by week for projection
    const poOutflows: PoOutflow[] = poOutflowRows.map((r: any) => ({
      po_id: r.po_id,
      supplier_name: r.supplier_name,
      expected_delivery_date: r.expected_delivery_date
        ? new Date(r.expected_delivery_date).toISOString()
        : null,
      total_cost: Math.round(Number(r.total_cost) * 100) / 100,
      status: r.status,
    }));

    // Build 60-day projection — 9 weekly points
    const projection60d: ProjectionPoint[] = [];
    let conservativeCumulative = 0;
    let baseCumulative = 0;
    let optimisticCumulative = 0;

    // Optimistic boost: blocked orders releasing adds at-risk revenue
    const optimisticBoost = atRiskRevenue;

    for (let week = 1; week <= 9; week++) {
      const weekDate = new Date();
      weekDate.setDate(weekDate.getDate() + week * 7);

      // PO outflows due this week
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() + (week - 1) * 7);
      const weekOutflows = poOutflows
        .filter(p => p.expected_delivery_date && new Date(p.expected_delivery_date) >= weekStart && new Date(p.expected_delivery_date) < weekDate)
        .reduce((sum, p) => sum + p.total_cost, 0);

      // Conservative: only confirmed pending revenue, no new sales
      const conservativeInflow = week === 1 ? pendingRevenue * 0.5 : 0;
      conservativeCumulative += conservativeInflow - weekOutflows;

      // Base: current velocity continues
      baseCumulative += weeklyVelocity - weekOutflows;

      // Optimistic: base + blocked orders release in week 1
      const optimisticInflow = week === 1 ? optimisticBoost : 0;
      optimisticCumulative += weeklyVelocity + optimisticInflow - weekOutflows;

      projection60d.push({
        week: weekDate.toISOString().split('T')[0],
        conservative: Math.round(conservativeCumulative * 100) / 100,
        base: Math.round(baseCumulative * 100) / 100,
        optimistic: Math.round(optimisticCumulative * 100) / 100,
      });
    }

    const summary: CashFlowSummary = {
      realized_revenue: Math.round(realizedRevenue * 100) / 100,
      pending_revenue: Math.round(pendingRevenue * 100) / 100,
      at_risk_revenue: Math.round(atRiskRevenue * 100) / 100,
      total_refunded: Math.round(totalRefunded * 100) / 100,
      inventory_value: Math.round(inventoryValue * 100) / 100,
      net_cash_position: Math.round(netCashPosition * 100) / 100,
      working_capital_locked: Math.round(workingCapitalLocked * 100) / 100,
    };

    const buckets: CashFlowBucket[] = [
      {
        label: 'Realized',
        orders: Number(realizedRow?.order_count ?? 0),
        revenue: summary.realized_revenue,
        description: 'Fulfilled orders — cash received',
      },
      {
        label: 'Pending',
        orders: Number(pendingRow?.order_count ?? 0),
        revenue: summary.pending_revenue,
        description: 'Paid but unfulfilled — cash expected',
      },
      {
        label: 'At Risk',
        orders: Number(atRiskRow?.order_count ?? 0),
        revenue: summary.at_risk_revenue,
        description: 'Constrained orders — cash uncertain',
      },
      {
        label: 'Refunded',
        orders: Number(refundRow?.refund_count ?? 0),
        revenue: summary.total_refunded,
        description: 'Cash returned to customers',
      },
    ];

    const byConstraint: CashFlowByConstraint[] = constraintRows.map((row: any) => ({
      constraint_type: row.constraint_type,
      orders: Number(row.order_count ?? 0),
      revenue_blocked: Math.round(Number(row.revenue_blocked ?? 0) * 100) / 100,
    }));

    const grossProfitResult: GrossProfit = {
      gross_revenue: Math.round(grossRevenue * 100) / 100,
      total_cogs: Math.round(totalCogs * 100) / 100,
      gross_profit: Math.round(grossProfit * 100) / 100,
      gross_margin_pct: grossMarginPct,
    };

    return {
      summary,
      gross_profit: grossProfitResult,
      buckets,
      by_constraint: byConstraint,
      po_outflows: poOutflows,
      projection_60d: projection60d,
      computed_at: new Date().toISOString(),
    };
  });
}