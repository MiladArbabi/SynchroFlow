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

    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      /**
       * NET MARGIN PULSE
       * ----------------
       * Source: order_margin_snapshot — projection engine owns this truth.
       * gross_margin = gross_revenue - estimated_cost (per order)
       */
      const marginSummary = await trx('order_margin_snapshot as oms')
        .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
          trx.raw('ROUND(SUM(oms.gross_revenue)::numeric, 2) as total_revenue'),
          trx.raw('ROUND(SUM(oms.estimated_cost)::numeric, 2) as total_cost'),
          trx.raw('ROUND(SUM(oms.gross_margin)::numeric, 2) as total_margin'),
          trx.raw('ROUND(AVG(oms.margin_pct) * 100, 1) as avg_margin_pct'),
          trx.raw('COUNT(*) FILTER (WHERE oms.margin_pct < 0) as negative_margin_orders'),
        )
        .first();

      /**
       * REFUND LEAKAGE
       * --------------
       * Total refund amount executed against this shop's orders.
       * Period: all-time (Intelligence tab is state-based, not windowed).
       */
      const refundRow = await trx('refund_executions as r')
        .join('orders as o', 'o.lasyncro_order_id', 'r.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(trx.raw('ROUND(SUM(r.total_refund_amount)::numeric, 2) as total_refunds'))
        .first();

      /**
       * COST COVERAGE
       * -------------
       * Active variants with unit_cost = 0 are blind spots in margin computation.
       * Drives "fix your costs" CTA → /products/costs
       */
      const costCoverage = await trx('variants')
        .where('shop_id', shopId)
        .where('status', 'active')
        .select(
          trx.raw('COUNT(*) as total_variants'),
          trx.raw('COUNT(*) FILTER (WHERE unit_cost = 0) as zero_cost_count'),
        )
        .first();

      /**
       * BLOCKED REVENUE AT MARGIN
       * -------------------------
       * Cross-domain: operational control snapshot × avg margin %.
       * Answers: "How much gross profit is trapped in blocked orders?"
       * Returns null gracefully when snapshot is empty (fresh install).
       */
      const blockedRow = await trx('orders_operational_control_snapshot')
        .where('shop_id', shopId)
        .select('blocked_revenue', 'constrained_orders')
        .first();

      return { marginSummary, refundRow, costCoverage, blockedRow };
    });

    const totalRevenue = Number(result.marginSummary?.total_revenue ?? 0);
    const totalCost    = Number(result.marginSummary?.total_cost ?? 0);
    const totalMargin  = Number(result.marginSummary?.total_margin ?? 0);
    const avgMarginPct = Number(result.marginSummary?.avg_margin_pct ?? 0);
    const totalRefunds = Number(result.refundRow?.total_refunds ?? 0);
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

    // Blocked revenue at margin — null when no operational snapshot exists
    const blockedRevenue = result.blockedRow?.blocked_revenue
      ? Number(result.blockedRow.blocked_revenue)
      : null;
    const blockedMarginValue = blockedRevenue != null && avgMarginPct > 0
      ? Math.round(blockedRevenue * (avgMarginPct / 100) * 100) / 100
      : null;

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
      negativemarginOrders: Number(result.marginSummary?.negative_margin_orders ?? 0),
      // Cost coverage
      costCoverage: {
        totalVariants,
        zeroCostCount,
        coveragePct: costCoveragePct,  // % of variants with cost entered
      },
      // Cross-domain: blocked revenue at margin
      blockedRevenue,
      blockedMarginValue,  // gross profit trapped in blocked orders
      constrainedOrders: result.blockedRow?.constrained_orders
        ? Number(result.blockedRow.constrained_orders)
        : null,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FINANCES_INTELLIGENCE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch finances intelligence: ${message}` });
  }
};