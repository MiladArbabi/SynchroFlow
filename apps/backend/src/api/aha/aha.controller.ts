// apps/backend/src/api/aha/aha.controller.ts
//
// AHA SIGNAL ENDPOINT
// -------------------
// GET /api/v1/aha/signal
//
// Runs the priority cascade and returns the highest-priority Aha signal
// for the authenticated shop.
//
// SIGNAL PRIORITY (evaluated in order, first match wins):
//   0 — Zero-order connected (SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02) —
//       authoritative sync completed, live orders count is 0
//   1 — Stock-out risk     (any SKU < 7 days stock)
//   2 — SLA risk           (any order SLA breached)
//   3 — Revenue concentration (top 10% customers > 30% revenue)
//   4 — Fulfilment gap     (aging_72h_plus > 0 with queue_ready contrast)
//   5 — [SKIP — no variant→supplier join yet]
//   6 — Velocity fallback  (always available — healthy operation)
//
// RULES:
// - Shop-scoped via JWT
// - Never writes to DB
// - All signals derived from existing snapshots — no heavy computation

import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { computeDemandIntelligence } from '../../services/demand/demandIntelligence.service.js';

// ─── Signal shape ─────────────────────────────────────────────────────────────

export type AhaSignalPriority = 0 | 1 | 2 | 3 | 4 | 6;

export interface AhaSupportingCard {
  label: string;
  value: string;
  sublabel?: string;
}

export interface AhaSignal {
  priority: AhaSignalPriority;
  /** Operator-vocabulary headline */
  headline: string;
  /** One-sentence explanation */
  detail: string;
  /** Revenue impact in store currency, null if not applicable */
  revenueImpact: number | null;
  /** 2-3 supporting data cards shown below the headline */
  cards: AhaSupportingCard[];
  /** Frontend route the CTA navigates to after FT2 unlock */
  deepLink: string;
  /** CTA label on the unlock button */
  ctaLabel: string;
}

export interface AhaSignalResponse {
  signal: AhaSignal;
  evaluatedAt: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

export async function getAhaSignal(req: Request, res: Response) {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    // ── Signal 0: Zero-order connected ───────────────────────────────────────
    // SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02 — a genuinely empty, authoritatively
    // completed store must not be told "LaSyncro found this in your store"
    // (nothing was found) nor left to fall through to the generic priority-6
    // "operation looks healthy" copy. Live DB facts only — never inferred
    // from lifecycle phase, which says nothing about sync outcome or order
    // volume. Reached before signal 1 by design: an empty store cannot have
    // a real stock-out/SLA/revenue/fulfilment signal, so those checks would
    // either no-op or (worse) fire on stale/irrelevant data.
    const zeroOrderCheck = await withTenant(shopId, async (trx) => {
      const integration = await trx('integrations')
        .where({ shop_id: shopId })
        .first('sync_status', 'sync_last_error');

      const authoritativeSync =
        integration?.sync_status === 'COMPLETED' &&
        (integration?.sync_last_error ?? null) === null;

      if (!authoritativeSync) {
        return { qualifies: false, productCount: 0 };
      }

      const orderCountRow = await trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();

      const orderCount = Number(orderCountRow?.count ?? 0);
      if (orderCount > 0) {
        return { qualifies: false, productCount: 0 };
      }

      const productCountRow = await trx('products')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();

      return {
        qualifies: true,
        productCount: Number(productCountRow?.count ?? 0),
      };
    });

    if (zeroOrderCheck.qualifies) {
      const signal: AhaSignal = {
        priority: 0,
        headline: "You're connected — no orders yet.",
        detail:
          "Your Shopify sync finished successfully. You can set up your warehouse now — insights will start populating when your first orders arrive.",
        revenueImpact: null,
        cards: [
          {
            label: 'Sync status',
            value: 'Complete',
            sublabel: 'Shopify connection ready',
          },
          {
            label: 'Products synced',
            value: String(zeroOrderCheck.productCount),
            sublabel: 'from your catalogue',
          },
          {
            label: 'Orders synced',
            value: '0',
            sublabel: 'no orders yet',
          },
        ],
        // Structurally present for response-shape compatibility with every
        // other signal — AhaMomentPage does not read either field for
        // routing/button behavior in this issue (locked CTA contract).
        deepLink: '/overview',
        ctaLabel: 'Unlock Insights',
      };

      return res.json({ signal, evaluatedAt: new Date().toISOString() });
    }

    // ── Signal 1: Current replenishment risk ─────────────────────────────────
    // Qualification and displayed facts come from the same current demand
    // computation. Generic inventory alerts are not stock-out authority.

    const demand = await computeDemandIntelligence(shopId);
    const criticalSkus = demand.variants.filter(
      (variant) => variant.reorder_urgency === 'critical'
    );

    if (criticalSkus.length > 0) {
      const outOfStockNow = criticalSkus.filter(
        (variant) => variant.available_quantity <= 0
      ).length;

      const criticalCount = criticalSkus.length;

      const signal: AhaSignal = {
        priority: 1,
        headline: `${criticalCount} SKU${criticalCount === 1 ? '' : 's'} ${criticalCount === 1 ? 'needs' : 'need'} replenishment attention`,
        detail:
          'LaSyncro found current stock and demand signals that need action before they constrain fulfillment.',
        revenueImpact: null,
        cards: [
          {
            label: 'SKUs needing action',
            value: String(criticalCount),
            sublabel: 'current replenishment urgency',
          },
          {
            label: 'Out of stock now',
            value: String(outOfStockNow),
            sublabel: 'zero available stock',
          },
          {
            label: 'Avg days of stock',
            value:
              demand.summary.avg_days_of_stock != null
                ? `${Math.round(demand.summary.avg_days_of_stock)}d`
                : '—',
            sublabel: 'across catalogue',
          },
        ],
        deepLink: '/inventory/replenishment?filter=critical',
        ctaLabel: 'Review critical SKUs',
      };

      return res.json({ signal, evaluatedAt: new Date().toISOString() });
    }

    // ── Signal 2: SLA risk ───────────────────────────────────────────────────
    // Condition: any orders where carrier ETA > promised delivery date

    const slaAlert = await withTenant(shopId, (trx) =>
      trx('alerts')
        .where({ shop_id: shopId, alert_type: 'sla_breach', is_active: true })
        .whereNull('dismissed_at')
        .orderBy('revenue_impact', 'desc')
        .first('title', 'message', 'revenue_impact')
    );

    if (slaAlert) {
      // Count SLA breach alerts for supporting cards
      const [slaCount, totalRevenue] = await withTenant(shopId, (trx) =>
        Promise.all([
          trx('alerts')
            .where({ shop_id: shopId, alert_type: 'sla_breach', is_active: true })
            .whereNull('dismissed_at')
            .count('* as count')
            .first(),
          trx('alerts')
            .where({ shop_id: shopId, alert_type: 'sla_breach', is_active: true })
            .whereNull('dismissed_at')
            .sum('revenue_impact as total')
            .first(),
        ])
      );

      const count = Number((slaCount as any)?.count ?? 0);

      const signal: AhaSignal = {
        priority: 2,
        headline: `${count} order${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} arriving late — your customers don't know yet`,
        detail: 'Showing before the customer complains is the difference between a recovery and a refund.',
        revenueImpact: (totalRevenue as any)?.total ? Number((totalRevenue as any).total) : null,
        cards: [
          {
            label: 'Orders at SLA risk',
            value: String(count),
            sublabel: 'past promised delivery',
          },
          {
            label: 'Revenue at risk',
            value: (totalRevenue as any)?.total
              ? `$${Math.round(Number((totalRevenue as any).total)).toLocaleString()}`
              : '—',
            sublabel: 'across late orders',
          },
          {
            label: 'Action available',
            value: 'Notify now',
            sublabel: 'before complaints arrive',
          },
        ],
        deepLink: '/orders?filter=sla_breached',
        ctaLabel: 'View at-risk orders',
      };

      return res.json({ signal, evaluatedAt: new Date().toISOString() });
    }

    // ── Signal 3: Revenue concentration risk ─────────────────────────────────
    // Condition: top 10% customers represent > 30% of revenue

    const revenueAlert = await withTenant(shopId, (trx) =>
      trx('alerts')
        .where({ shop_id: shopId, alert_type: 'revenue_at_risk', is_active: true })
        .whereNull('dismissed_at')
        .orderBy('revenue_impact', 'desc')
        .first('title', 'message', 'revenue_impact')
    );

    if (revenueAlert) {
      // Get customer count for supporting cards
      const customerCount = await withTenant(shopId, (trx) =>
        trx('customers')
          .where({ shop_id: shopId })
          .count('* as count')
          .first()
      );

      const totalCustomers = Number((customerCount as any)?.count ?? 0);
      const topTenPct = Math.max(1, Math.round(totalCustomers * 0.1));

      const signal: AhaSignal = {
        priority: 3,
        headline: revenueAlert.title,
        detail: 'Revenue concentration this high means one customer leaving costs more than a month of new acquisitions.',
        revenueImpact: revenueAlert.revenue_impact ? Number(revenueAlert.revenue_impact) : null,
        cards: [
          {
            label: 'Top customers',
            value: String(topTenPct),
            sublabel: 'driving concentrated revenue',
          },
          {
            label: 'Total customers',
            value: String(totalCustomers),
            sublabel: 'in your store',
          },
          {
            label: 'Revenue at risk',
            value: revenueAlert.revenue_impact
              ? `$${Math.round(Number(revenueAlert.revenue_impact)).toLocaleString()}`
              : '—',
            sublabel: 'if top customers churn',
          },
        ],
        deepLink: '/orders?filter=revenue_concentration',
        ctaLabel: 'See your top customers',
      };

      return res.json({ signal, evaluatedAt: new Date().toISOString() });
    }

    // ── Signal 4: Fulfilment gap ──────────────────────────────────────────────
    // Condition: aging_72h_plus > 0 with queue_ready_to_ship contrast

    const opControl = await withTenant(shopId, (trx) =>
      trx('orders_operational_control_snapshot')
        .where({ shop_id: shopId })
        .orderBy('snapshot_date', 'desc')
        .first(
          'aging_72h_plus',
          'queue_ready_to_ship',
          'constrained_orders',
          'at_risk_revenue'
        )
    );

    if (opControl && Number(opControl.aging_72h_plus ?? 0) > 0) {
      const aging = Number(opControl.aging_72h_plus);
      const readyToShip = Number(opControl.queue_ready_to_ship ?? 0);

      const signal: AhaSignal = {
        priority: 4,
        headline: `${aging} order${aging === 1 ? '' : 's'} ${aging === 1 ? 'has' : 'have'} been waiting over 72 hours`,
        detail: 'Your fastest orders ship in under a day. LaSyncro can show you why these are stuck.',
        revenueImpact: opControl.at_risk_revenue ? Number(opControl.at_risk_revenue) : null,
        cards: [
          {
            label: 'Aging 72h+',
            value: String(aging),
            sublabel: 'orders past 72 hours',
          },
          {
            label: 'Ready to ship',
            value: String(readyToShip),
            sublabel: 'orders in queue',
          },
          {
            label: 'Constrained',
            value: String(opControl.constrained_orders ?? 0),
            sublabel: 'orders blocked',
          },
        ],
        deepLink: '/orders?filter=aging_72h',
        ctaLabel: 'Explore fulfilment patterns',
      };

      return res.json({ signal, evaluatedAt: new Date().toISOString() });
    }

    // ── Signal 6: Velocity intelligence fallback ──────────────────────────────
    // Always available — healthy operation confirmation

    const topVariant = demand.variants
      .filter(v => v.velocity_per_day > 0)
      .sort((a, b) => (b.units_sold_30d ?? 0) - (a.units_sold_30d ?? 0))[0];

    const signal: AhaSignal = {
      priority: 6,
      headline: 'Your operation looks healthy',
      detail: "LaSyncro is watching. We'll surface issues the moment they emerge — so you can act before customers notice.",
      revenueImpact: null,
      cards: [
        {
          label: 'Variants tracked',
          value: String(demand.summary.total_variants_tracked),
          sublabel: 'across catalogue',
        },
        {
          label: 'Avg days of stock',
          value: demand.summary.avg_days_of_stock != null
            ? `${Math.round(demand.summary.avg_days_of_stock)}d`
            : '—',
          sublabel: 'healthy buffer',
        },
        {
          label: 'Top mover',
          value: topVariant ? `${topVariant.units_sold_30d} units` : '—',
          sublabel: topVariant?.sku ?? topVariant?.title ?? 'last 30 days',
        },
      ],
      deepLink: '/overview',
      ctaLabel: 'Set up your Morning Brief',
    };

    return res.json({ signal, evaluatedAt: new Date().toISOString() });

  } catch (err) {
    console.error('[AHA_SIGNAL_FAILED]', err);
    return res.status(500).json({ error: 'Failed to evaluate Aha signal' });
  }
}
