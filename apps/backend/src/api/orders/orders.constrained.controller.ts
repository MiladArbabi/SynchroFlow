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

      /*
       * FLOW-BUCKET-ELECTION-01 (2026-08-13)
       * ------------------------------------
       * An order may hold several active constraints at once (locally,
       * 9 of 19 held both customer and inventory). This DISTINCT ON
       * elects exactly one to drive the card, its bucket and the
       * decision join below.
       *
       * The previous chain ordered on started_at alone. Both constraints
       * are written inside the SAME projection transaction, so started_at
       * ties to the second on every multi-blocked order — the chain was
       * not total and Postgres returned whichever row the plan produced.
       * The elected constraint was therefore arbitrary and could differ
       * between two identical requests.
       *
       * Precedence is now explicit and the chain is total:
       *   operational (post-release exception — BL-01b) beats
       *   customer    (merchant-actionable today, no lead time) beats
       *   inventory   (may clear on its own via inbound PO)
       * then started_at DESC, then constraint_id as a final total key.
       *
       * Buckets stay mutually exclusive — every downstream count is
       * unchanged. The blockers the operator is NOT being shown are
       * surfaced separately via otherBlockerTypes below.
       */
      const dedupedConstraints = trx('order_constraints')
        .distinctOn('lasyncro_order_id')
        .select('lasyncro_order_id', 'constraint_type', 'block_type', 'started_at', 'is_active')
        .where('is_active', true)
        .orderByRaw(`
          lasyncro_order_id,
          CASE constraint_type
            WHEN 'operational' THEN 0
            WHEN 'customer'    THEN 1
            WHEN 'inventory'   THEN 2
            ELSE 3
          END,
          started_at DESC NULLS LAST,
          constraint_id
        `)
        .as('oc');

      /*
       * FLOW-MULTIBLOCK-01: the other active constraint types on the
       * same order, excluding the elected one. Aggregated by TYPE, not
       * by row — inventory constraints are line-scoped (target_id), so
       * an order short on three lines is still one blocker to an
       * operator. Empty array when the elected constraint is the only
       * one. Never drives the bucket or the CTA.
       */
      const otherBlockerTypes = trx('order_constraints')
        .select('lasyncro_order_id')
        .select(trx.raw('array_agg(DISTINCT constraint_type) as all_types'))
        .where('is_active', true)
        .groupBy('lasyncro_order_id')
        .as('obt');

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
            .select(
              'lasyncro_order_id',
              'age_since_creation_seconds',
              'age_since_paid_seconds',
              'is_shipping_sla_breached',
              'is_delivery_sla_breached'
            )
            .distinctOn('lasyncro_order_id')
            .orderByRaw('lasyncro_order_id, aggregate_version DESC')
            .as('oas'),
          'oas.lasyncro_order_id', 'oc.lasyncro_order_id'
        )
        .leftJoin('order_margin_snapshot as oms', 'oms.lasyncro_order_id', 'oc.lasyncro_order_id')
        .leftJoin(
          'shop_operational_settings as sos',
          'sos.shop_id',
          'o.shop_id'
        )
        .leftJoin(otherBlockerTypes, 'obt.lasyncro_order_id', 'oc.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
          'oc.lasyncro_order_id as order_id',
          'eim.external_order_id',
          'oc.constraint_type',
          'oc.block_type',
          'oc.started_at as constrained_since',
          /*
           * FLOW-MULTIBLOCK-01: active constraint types on this order
           * OTHER than the elected one. The elected type is stripped
           * here rather than in the aggregate, because obt is grouped
           * before the DISTINCT ON result is known.
           *
           * COALESCE to an empty array so the field is never null —
           * the client can branch on length alone. Cast is explicit:
           * array_remove on an empty array would otherwise be unknown-typed.
           */
          trx.raw(`
            COALESCE(
              array_remove("obt"."all_types", "oc"."constraint_type"),
              ARRAY[]::text[]
            ) as other_blocker_types
          `),
          'o.total_price as revenue',
          'o.promised_ship_by',
          'd.recommended_action',
          'd.priority',
          'd.id as decision_id',
          // SLA fields
          'oas.age_since_creation_seconds',
          'oas.age_since_paid_seconds',
          'oas.is_shipping_sla_breached',
          'oas.is_delivery_sla_breached',
          'sos.fulfillment_sla_hours',
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