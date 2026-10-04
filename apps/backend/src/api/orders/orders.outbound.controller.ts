// apps/backend/src/api/orders/orders.outbound.controller.ts

import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/outbound
 * ---------------------------
 * Canonical Outbound read model: orders LaSyncro has PHYSICALLY shipped.
 *
 * DELIBERATELY SEPARATE FROM /orders/fulfilled — do not merge them.
 *
 *   /orders/fulfilled  reads commercial fulfillment truth
 *                      (order_fulfillment_status), which a Shopify-only
 *                      fulfillment can satisfy without any physical shipment.
 *
 *   THIS endpoint      reads physical shipment truth: order_warehouse_status
 *                      status = 'shipped' with shipped_at, written only by
 *                      confirmShipment (shipConfirmation.service.ts).
 *
 * MEMBERSHIP
 * - order_warehouse_status.status = 'shipped' AND shipped_at IS NOT NULL.
 * - partially_shipped is excluded; its Outbound representation is deferred.
 * - shipped → cancelled historical membership is deferred (not handled here).
 *
 * TRACKING
 * - order_shipment_tracking may carry several rows per order. Only the latest
 *   row (created_at DESC, the repository precedent, with id DESC as a total
 *   tie-breaker) is read, through a LATERAL LIMIT 1 — one ledger row per order.
 * - carrier          = provider_carrier_code (physical carrier, when known).
 * - carrier_provider = carrier_code (label provider: sendcloud | shippo).
 *   The provider is never reported as the physical carrier.
 *
 * DIMENSIONS
 * - period (week | month | all) bounds shipped_at in the SHOP timezone
 *   (shops.timezone): week starts Monday 00:00 local, month starts on the
 *   first local calendar day 00:00. No rolling windows, never fulfilled_at.
 * - state (all | needs_action | missing_tracking | in_transit | delivered)
 *   and q are ledger working-set filters. States are not mutually exclusive.
 *
 * SUMMARY
 * - Scoped to PERIOD ONLY. It never narrows with state, q, page or limit.
 * - No value-shipped aggregate: orders carry their own currency and
 *   mixed-currency summing is an open contract question.
 *
 * RULES
 * - Read-only
 * - Tenant isolation via withTenant() (RLS + tenant context); o.shop_id
 *   predicate is defence in depth
 * - Server owns filtering, total, sorting and pagination
 */

const STATES = ['all', 'needs_action', 'missing_tracking', 'in_transit', 'delivered'] as const;
const PERIODS = ['week', 'month', 'all'] as const;

type OutboundState = (typeof STATES)[number];
type OutboundPeriod = (typeof PERIODS)[number];

const STATE_PREDICATES: Record<OutboundState, string | null> = {
  all: null,
  missing_tracking: 'm.tracking_number IS NULL',
  in_transit: `m.latest_status IN ('in_transit', 'out_for_delivery')`,
  delivered: `m.latest_status = 'delivered'`,
  // A tracking number with latest_status NULL is not needs_action by itself.
  needs_action: `(
    m.tracking_number IS NULL
    OR m.is_stalled = true
    OR m.latest_status IN ('exception', 'returned', 'unknown')
  )`,
};

/** Lower shipped_at bound, computed in the shop's local calendar. */
const PERIOD_LOWER_BOUND: Record<OutboundPeriod, string | null> = {
  // Postgres date_trunc('week') is ISO: Monday 00:00.
  week: `(date_trunc('week', now() AT TIME ZONE s.timezone) AT TIME ZONE s.timezone)`,
  month: `(date_trunc('month', now() AT TIME ZONE s.timezone) AT TIME ZONE s.timezone)`,
  all: null,
};

const SORT_FIELDS: Record<string, string> = {
  shipped_at: 'm.shipped_at',
  total_price: 'm.total_price',
  latest_event_at: 'm.latest_event_at',
  external_order_id: 'm.external_order_id',
};

/** Escape LIKE metacharacters so a search term matches literally. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T | null {
  if (value === undefined || value === '') return fallback;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export const httpGetOutboundOrders = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const state = parseEnum(req.query.state, STATES, 'all');
    if (!state) {
      return res.status(400).json({ error: `Invalid state. Expected one of: ${STATES.join(', ')}` });
    }
    const period = parseEnum(req.query.period, PERIODS, 'all');
    if (!period) {
      return res.status(400).json({ error: `Invalid period. Expected one of: ${PERIODS.join(', ')}` });
    }

    const page   = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const sortField = SORT_FIELDS[req.query.sort as string] ?? SORT_FIELDS.shipped_at;
    const sortDir   = req.query.dir === 'asc' ? 'ASC' : 'DESC';

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const periodBound = PERIOD_LOWER_BOUND[period];
    const statePredicate = STATE_PREDICATES[state];

    /**
     * Period-scoped membership with the latest tracking row attached. Both the
     * summary and the ledger read from this one population, so the summary can
     * never disagree with what the ledger would show under state = 'all'.
     */
    const membersSql = `
      SELECT
        o.lasyncro_order_id,
        o.total_price,
        o.currency,
        o.order_created_at,
        o.shipping_name,
        ows.shipped_at,
        (
          SELECT eim.external_order_id
          FROM external_order_identity_map AS eim
          WHERE eim.lasyncro_order_id = o.lasyncro_order_id
            AND eim.shop_id = o.shop_id
          -- Canonical identity when an order has several mappings: the
          -- earliest by id (same rule as the Outbound export).
          ORDER BY eim.id ASC
          LIMIT 1
        ) AS external_order_id,
        ost.tracking_number,
        ost.provider_carrier_code AS carrier,
        ost.carrier_code AS carrier_provider,
        ost.latest_status,
        ost.latest_event_at,
        ost.is_stalled
      FROM orders AS o
      JOIN order_warehouse_status AS ows
        ON ows.lasyncro_order_id = o.lasyncro_order_id
      JOIN shops AS s
        ON s.id = o.shop_id
      LEFT JOIN LATERAL (
        SELECT t.*
        FROM order_shipment_tracking AS t
        WHERE t.lasyncro_order_id = o.lasyncro_order_id
          AND t.shop_id = o.shop_id
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1
      ) AS ost ON true
      WHERE o.shop_id = :shopId
        AND ows.status = 'shipped'
        AND ows.shipped_at IS NOT NULL
        ${periodBound ? `AND ows.shipped_at >= ${periodBound}` : ''}
    `;

    /**
     * Search is an EXISTS over line items, never a join, so a multi-line order
     * cannot fan out into several ledger rows.
     */
    const searchPredicate = q
      ? `AND (
          m.external_order_id ILIKE :like
          OR m.shipping_name ILIKE :like
          OR EXISTS (
            SELECT 1
            FROM order_line_items AS oli
            LEFT JOIN variants AS v
              ON v.lasyncro_variant_id = oli.lasyncro_variant_id
            WHERE oli.lasyncro_order_id = m.lasyncro_order_id
              AND (oli.sku ILIKE :like OR v.sku ILIKE :like)
          )
        )`
      : '';

    const ledgerWhere = `
      WHERE true
        ${statePredicate ? `AND ${statePredicate}` : ''}
        ${searchPredicate}
    `;

    const bindings = { shopId, like: likeContains(q), limit, offset };

    const { rows, total, summary } = await withTenant(shopId, async (trx) => {
      const summaryResult = await trx.raw(
        `
        WITH m AS (${membersSql})
        SELECT
          COUNT(*)::int AS shipped_count,
          COUNT(*) FILTER (WHERE m.tracking_number IS NOT NULL)::int AS with_tracking_count,
          COUNT(*) FILTER (WHERE m.tracking_number IS NULL)::int AS missing_tracking_count,
          AVG(EXTRACT(EPOCH FROM (m.shipped_at - m.order_created_at)) / 3600.0)
            FILTER (WHERE m.order_created_at IS NOT NULL) AS avg_time_to_ship_hours
        FROM m
        `,
        bindings
      );

      const countResult = await trx.raw(
        `
        WITH m AS (${membersSql})
        SELECT COUNT(*)::int AS total FROM m ${ledgerWhere}
        `,
        bindings
      );

      const rowsResult = await trx.raw(
        `
        WITH m AS (${membersSql})
        SELECT
          m.lasyncro_order_id,
          m.external_order_id,
          m.shipped_at,
          m.total_price,
          m.currency,
          m.tracking_number,
          m.carrier,
          m.carrier_provider,
          m.latest_status,
          m.latest_event_at,
          m.is_stalled
        FROM m
        ${ledgerWhere}
        ORDER BY ${sortField} ${sortDir} NULLS LAST, m.lasyncro_order_id ASC
        LIMIT :limit OFFSET :offset
        `,
        bindings
      );

      const s = summaryResult.rows[0];
      const shippedCount = Number(s.shipped_count);
      const withTracking = Number(s.with_tracking_count);

      return {
        rows: rowsResult.rows,
        total: Number(countResult.rows[0].total),
        summary: {
          shipped_count: shippedCount,
          with_tracking_count: withTracking,
          missing_tracking_count: Number(s.missing_tracking_count),
          tracking_coverage_pct: shippedCount === 0 ? null : (withTracking / shippedCount) * 100,
          avg_time_to_ship_hours:
            s.avg_time_to_ship_hours === null ? null : Number(s.avg_time_to_ship_hours),
        },
      };
    });

    return res.status(200).json({
      orders: rows,
      total,
      page,
      limit,
      state,
      period,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[OUTBOUND_ORDERS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch outbound orders: ${message}`,
    });
  }
};
