// apps/backend/src/api/orders/orders.constrained.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/constrained
 * ------------------------------
 * Returns paginated list of constrained orders for the Fulfillment Queue UI.
 *
 * Source of truth:
 * - order_constraints (canonical, is_active per type)
 * - orders (revenue, identity)
 * - decisions (recommended_action)
 *
 * RULES:
 * - Read-only
 * - RLS enforced via app.current_tenant SET LOCAL
 * - Never compute constraints here — reads order_constraints only
 *
 * Query params:
 * - page (default 1)
 * - limit (default 50, max 100)
 * - constraint_type: 'operational' | 'inventory' | 'customer' (optional filter)
 */
export const httpGetConstrainedOrders = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const constraintType = req.query.constraint_type as string | undefined;

    const rows = await db.transaction(async (trx) => {
      /**
       * RLS CONTEXT (CRITICAL)
       * ----------------------
       * Must be SET LOCAL inside transaction before any RLS-protected table access.
       * Canonical variable: app.current_tenant (integer)
       * 
       * NOTE:
       * SET LOCAL does not support parameter binding in PostgreSQL.
       * shopId is a verified integer from req.user — safe to inline.
       * Pattern matches withTenant() in packages/backend-core/src/db.ts.
       */
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Deduplicate order_constraints — one row per order, most recent constraint wins
      const dedupedConstraints = trx('order_constraints')
        .distinctOn('lasyncro_order_id')
        .select('lasyncro_order_id', 'constraint_type', 'block_type', 'started_at', 'is_active')
        .where('is_active', true)
        .orderByRaw('lasyncro_order_id, started_at DESC NULLS LAST')
        .as('oc');

      const query = trx(dedupedConstraints)
        .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
        .leftJoin('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'oc.lasyncro_order_id')
        .leftJoin(
          /**
           * DECISION MATCHING FIX (2026-07-02)
           * -----------------------------------
           * Comment above previously claimed "single highest-priority
           * decision per order" but the code never actually deduped —
           * no DISTINCT ON, no per-entity limit, no status filter. A
           * plain entity_id join against ALL of a shop's decisions
           * fans out 1 constraint row × N matching decisions, producing
           * duplicate cards for the same order (confirmed live: one
           * order with both a stale resolve_inventory_block decision
           * and the real resolve_customer_block decision, both
           * 'pending', both rendered as separate cards under the same
           * constraint category).
           *
           * Real fix: only join a decision whose recommended_action
           * type actually corresponds to oc.constraint_type — the
           * single active constraint already selected by
           * dedupedConstraints above. This guarantees at most one
           * matching decision per order and can never surface a
           * decision for a constraint type that isn't currently
           * active, regardless of how many stale/duplicate decisions
           * exist in the table. Same CONSTRAINT_TYPE_BY_ACTION mapping
           * as orders.decision-by-order.controller.ts's staleness
           * check — kept in sync conceptually, not shared as a single
           * source (different layer: SQL join vs. app-level filter).
           */
          trx('decisions')
            .select('entity_id', 'recommended_action', 'priority', 'id', 'shop_id')
            .where('shop_id', shopId)
            .whereIn('status', ['pending', 'in_progress'])
            .as('d'),
          function () {
            this.on(trx.raw('"d"."entity_id"::uuid = "oc"."lasyncro_order_id"'))
              .andOn(trx.raw(`
                "d"."recommended_action"->>'type' = CASE "oc"."constraint_type"
                  WHEN 'inventory' THEN 'resolve_inventory_block'
                  WHEN 'customer' THEN 'resolve_customer_block'
                  WHEN 'operational' THEN 'resolve_operational_block'
                  ELSE NULL
                END
              `));
          }
        )
        .leftJoin(
          // Take only the latest aggregate_version per order
          trx('order_age_snapshot')
            .select('lasyncro_order_id', 'age_since_creation_seconds', 'is_shipping_sla_breached', 'is_delivery_sla_breached')
            .distinctOn('lasyncro_order_id')
            .orderByRaw('lasyncro_order_id, aggregate_version DESC')
            .as('oas'),
          'oas.lasyncro_order_id', 'oc.lasyncro_order_id'
        )
        .leftJoin('order_margin_snapshot as oms', 'oms.lasyncro_order_id', 'oc.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
          'oc.lasyncro_order_id as order_id',
          'eim.external_order_id',
          'oc.constraint_type',
          'oc.block_type',
          'oc.started_at as constrained_since',
          'o.total_price as revenue',
          'o.promised_ship_by',
          'd.recommended_action',
          'd.priority',
          'd.id as decision_id',
          // SLA fields
          'oas.age_since_creation_seconds',
          'oas.is_shipping_sla_breached',
          'oas.is_delivery_sla_breached',
          // Margin fields (Growth-tier display only — never used for enforcement)
          'oms.gross_margin',
          'oms.margin_pct'
        )
        /**
         * SLA-AWARE SORT ORDER
         * --------------------
         * Priority: SLA breached first, then by age descending.
         * Operators must see the most urgent orders at the top.
         */
        .orderByRaw('oas.is_shipping_sla_breached DESC NULLS LAST')
        .orderByRaw('oas.age_since_creation_seconds DESC NULLS LAST')
        .orderBy('d.priority', 'desc')
        .limit(limit)
        .offset(offset);

      if (constraintType) {
        query.where('oc.constraint_type', constraintType);
      }

      return query;
    });

    return res.status(200).json({
      data: rows,
      pagination: {
        page,
        limit,
        /**
         * NOTE: total count omitted for performance — use next page presence
         * to determine if more results exist. Add COUNT query if UI requires it.
         */
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CONSTRAINED_ORDERS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch constrained orders: ${message}`,
    });
  }
};