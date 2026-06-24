// apps/backend/src/api/finances/finances.intelligence.controller.ts
//
// GET /api/v1/modules/finances/intelligence
// -----------------------------------------
// Aggregated intelligence signals for the Finances Intelligence tab.
//
// Signals:
//   - Net margin pulse (revenue, cost, refunds, net margin %)
//   - Cost coverage (variants with unit_cost = 0 vs total active)
//   - Negative margin order count
//   - Refund leakage (total refunded amount in period)
//   - Blocked revenue at margin (cross-domain: operational snapshot × avg margin)
//
// RLS: all queries wrapped in withTenant via db.transaction + SET LOCAL

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export const httpGetFinancesIntelligence = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    // UX-sweep 2026-06-23: optional period args. Default last 30d.
    const now = new Date();
    const fromParam = req.query.from as string | undefined;
    const toParam = req.query.to as string | undefined;
    const periodTo = toParam ? new Date(toParam) : now;
    const periodFrom = fromParam
      ? new Date(fromParam)
      : new Date(periodTo.getTime() - 30 * 24 * 60 * 60 * 1000);
    const periodMs = periodTo.getTime() - periodFrom.getTime();
    const priorTo = new Date(periodFrom.getTime());
    const priorFrom = new Date(periodFrom.getTime() - periodMs);

    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const queryPeriod = async (since: Date, until: Date) => {
        const marginSummary = await trx('order_margin_snapshot as oms')
          .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
          .where('o.shop_id', shopId)
          .whereBetween('oms.evaluated_at', [since, until])
          .select(
            trx.raw('ROUND(SUM(oms.gross_revenue)::numeric, 2) as total_revenue'),
            trx.raw('ROUND(SUM(oms.estimated_cost)::numeric, 2) as total_cost'),
            trx.raw('ROUND(SUM(oms.gross_margin)::numeric, 2) as total_margin'),
            trx.raw('ROUND(AVG(oms.margin_pct) * 100, 1) as avg_margin_pct'),
            trx.raw('COUNT(*) FILTER (WHERE oms.margin_pct < 0) as negative_margin_orders'),
            trx.raw('ROUND(SUM(oms.carrier_shipping_cost)::numeric, 2) as total_shipping_cost'),
            trx.raw('ROUND(SUM(oms.true_margin)::numeric, 2) as total_true_margin'),
            trx.raw('ROUND(AVG(oms.true_margin_pct) * 100, 1) as avg_true_margin_pct'),
            trx.raw('COUNT(oms.true_margin) as orders_with_carrier_cost'),
          )
          .first();
        const refundRow = await trx('refund_executions as r')
          .join('orders as o', 'o.lasyncro_order_id', 'r.lasyncro_order_id')
          .where('o.shop_id', shopId)
          .whereBetween('r.created_at', [since, until])
          .select(trx.raw('ROUND(SUM(r.total_refund_amount)::numeric, 2) as total_refunds'))
          .first();
        return { marginSummary, refundRow };
      };

      const current = await queryPeriod(periodFrom, periodTo);
      const prior   = await queryPeriod(priorFrom, priorTo);

      // State-based (not period-scoped): variant config + operational snapshot.
      const costCoverage = await trx('variants')
        .where('shop_id', shopId)
        .where('status', 'active')
        .select(
          trx.raw('COUNT(*) as total_variants'),
          trx.raw('COUNT(*) FILTER (WHERE unit_cost = 0) as zero_cost_count'),
        )
        .first();
      const blockedRow = await trx('orders_operational_control_snapshot')
        .where('shop_id', shopId)
        .select('blocked_revenue', 'constrained_orders')
        .first();

      return { current, prior, costCoverage, blockedRow };
    });

    const totalRevenue = Number(result.current.marginSummary?.total_revenue ?? 0);
    const totalCost    = Number(result.current.marginSummary?.total_cost ?? 0);
    const totalMargin  = Number(result.current.marginSummary?.total_margin ?? 0);
    const avgMarginPct = Number(result.current.marginSummary?.avg_margin_pct ?? 0);
    const totalRefunds = Number(result.current.refundRow?.total_refunds ?? 0);
    const totalVariants   = Number(result.costCoverage?.total_variants ?? 0);
    const zeroCostCount   = Number(result.costCoverage?.zero_cost_count ?? 0);
    const costCoveragePct = totalVariants > 0
      ? Math.round(((totalVariants - zeroCostCount) / totalVariants) * 100)
      : null;

    // Net margin = gross margin - refunds (costs already baked into gross margin)
    const netMargin    = totalMargin - totalRefunds;
    const netMarginPct = totalRevenue > 0
      ? Math.round((netMargin / totalRevenue) * 100 * 10) / 10
      : null;

    // FIN-01 (2026-06-23): TRUE MARGIN (revenue − COGS − carrier shipping).
    // Sourced from order_margin_snapshot.true_margin, populated only when a
    // carrier label exists (WM-39). hasCarrierData lets the UI choose the
    // honest headline: GROSS when no shipping cost is known, TRUE once it is.
    // Never present gross as "net" — the previous behaviour silently omitted
    // shipping it never had.
    const ordersWithCarrierCost = Number(result.current.marginSummary?.orders_with_carrier_cost ?? 0);
    const hasCarrierData = ordersWithCarrierCost > 0;
    const trueMargin    = hasCarrierData
      ? Number(result.current.marginSummary?.total_true_margin ?? 0)
      : null;
    const trueMarginPct = hasCarrierData
      ? Number(result.current.marginSummary?.avg_true_margin_pct ?? 0)
      : null;

    // Blocked revenue at margin — null when no operational snapshot exists
    const blockedRevenue = result.blockedRow?.blocked_revenue
      ? Number(result.blockedRow.blocked_revenue)
      : null;
    const blockedMarginValue = blockedRevenue != null && avgMarginPct > 0
      ? Math.round(blockedRevenue * (avgMarginPct / 100) * 100) / 100
      : null;
    
    // Prior-period totals for comparison delta.
    const priorRevenue = Number(result.prior.marginSummary?.total_revenue ?? 0);
    const priorMargin  = Number(result.prior.marginSummary?.total_margin ?? 0);
    const priorRefunds = Number(result.prior.refundRow?.total_refunds ?? 0);
    const priorNetMargin = priorMargin - priorRefunds;
    const priorAvgMarginPct = Number(result.prior.marginSummary?.avg_margin_pct ?? 0);

    const pctDelta = (curr: number, prev: number): number | null =>
      prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;

    const comparison = {
      period: { from: periodFrom.toISOString(), to: periodTo.toISOString() },
      prior:  { from: priorFrom.toISOString(),  to: priorTo.toISOString() },
      delta: {
        revenuePct:   pctDelta(totalRevenue, priorRevenue),
        marginPct:    pctDelta(totalMargin, priorMargin),
        netMarginPct: pctDelta(netMargin, priorNetMargin),
        refundsPct:   pctDelta(totalRefunds, priorRefunds),
        avgMarginPtDelta: Math.round((avgMarginPct - priorAvgMarginPct) * 10) / 10,
      },
      priorTotals: {
        totalRevenue: priorRevenue,
        totalMargin: priorMargin,
        totalRefunds: priorRefunds,
        netMargin: priorNetMargin,
        avgMarginPct: priorAvgMarginPct,
      },
    };

    return res.status(200).json({
      // Revenue triangle
      totalRevenue,
      totalCost,
      totalMargin,
      avgMarginPct,
      // Refund leakage
      totalRefunds,
      // Net margin after refunds
      netMargin,
      netMarginPct,
      // Negative margin orders
      negativemarginOrders: Number(result.current.marginSummary?.negative_margin_orders ?? 0),
      // Cost coverage
      costCoverage: {
        totalVariants,
        zeroCostCount,
        coveragePct: costCoveragePct,  // % of variants with cost entered
      },
      // Cross-domain: blocked revenue at margin
      blockedRevenue,
      blockedMarginValue,
      constrainedOrders: result.blockedRow?.constrained_orders
        ? Number(result.blockedRow.constrained_orders)
        : null,
      totalShippingCost: result.current.marginSummary?.total_shipping_cost != null
        ? Number(result.current.marginSummary.total_shipping_cost)
        : null,
      // FIN-01: true-margin surface + presence flag for honest headline switch
      trueMargin,
      trueMarginPct,
      hasCarrierData,
      // UX-sweep 2026-06-23: prior-period totals + delta for "How am I doing?" framing.
      comparison,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FINANCES_INTELLIGENCE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch finances intelligence: ${message}` });
  }
};