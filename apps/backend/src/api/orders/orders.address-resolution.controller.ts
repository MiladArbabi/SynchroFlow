// apps/backend/src/api/orders/orders.address-resolution.controller.ts

import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/address-resolution
 * -------------------------------------
 * Authoritative Address Resolution Session membership: every order in the
 * current tenant that right now holds an active
 * customer / incomplete_address constraint.
 *
 * DELIBERATELY SEPARATE FROM /orders/constrained — do not merge them.
 *
 *   /orders/constrained  is the ELECTED projection. It runs
 *                        DISTINCT ON (lasyncro_order_id) with an explicit
 *                        precedence (operational 0 > customer 1 > inventory 2)
 *                        so Order Flow's blocked buckets stay mutually
 *                        exclusive, and it applies ?constraint_type= AFTER that
 *                        election. An order holding both an active operational
 *                        constraint and an active customer/incomplete_address
 *                        constraint is therefore elected 'operational' and
 *                        disappears from ?constraint_type=customer — while
 *                        still genuinely needing an address correction.
 *
 *   THIS endpoint         is UNELECTED canonical treatment membership. Election
 *                        is a presentation concern for Flow's buckets; it is
 *                        not truth about which orders need an address fixed.
 *
 * Reusing /orders/constrained here would either miss those multi-blocked orders
 * or require changing an election that every downstream Flow count depends on.
 * Hence a second, narrow read rather than a flag on the first.
 *
 * SOURCE OF TRUTH
 * - order_constraints (canonical, is_active + block_type per constraint)
 * - orders (identity, address, value)
 * Never computes constraints — reads them only.
 *
 * RULES
 * - Read-only
 * - Tenant isolation via withTenant() (RLS + AsyncLocalStorage tenant context);
 *   no privileged role, no RLS bypass
 * - One row per order, guaranteed structurally (see below)
 */

/** Fields the Address Resolution Session needs, and nothing more. */
const SESSION_COLUMNS = [
  'o.lasyncro_order_id',
  'o.currency',
  'o.total_price',
  // Seeds the existing shipping-address correction form without a second fetch.
  'o.shipping_name',
  'o.shipping_address1',
  'o.shipping_address2',
  'o.shipping_city',
  'o.shipping_zip',
  'o.shipping_province',
  'o.shipping_country_code',
  'o.shipping_phone',
] as const;

export const httpGetAddressResolutionOrders = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rows = await withTenant(shopId, (trx) =>
      trx('orders as o')
        /**
         * DEDUPLICATION IS STRUCTURAL, NOT A DISTINCT.
         * ------------------------------------------------
         * The driving table is `orders`, and the constraint is tested with
         * whereExists rather than a join. A join to order_constraints would fan
         * out one row per qualifying constraint row; an EXISTS cannot, so an
         * order appears exactly once no matter how many qualifying constraint
         * rows it carries. This also means no DISTINCT ON is involved anywhere
         * — there is nothing here that could become an election.
         */
        .whereExists((sub) =>
          sub
            .select(trx.raw('1'))
            .from('order_constraints as oc')
            .whereRaw('oc.lasyncro_order_id = o.lasyncro_order_id')
            .where('oc.is_active', true)
            .where('oc.constraint_type', 'customer')
            // block_type is the session's definition of membership. A customer
            // constraint with any other block_type is a different problem with a
            // different resolution, so it is not session work.
            .where('oc.block_type', 'incomplete_address')
        )
        /**
         * RLS is the tenant boundary; this predicate is defence in depth, the
         * same posture orders.constrained.controller.ts states.
         */
        .where('o.shop_id', shopId)
        .select([
          ...SESSION_COLUMNS,
          /**
           * Oldest qualifying constraint start, as a correlated scalar so the
           * row count cannot change. Drives the session row's age label and the
           * ordering below.
           */
          trx.raw(
            `(
               SELECT MIN(oc2.started_at)
               FROM order_constraints AS oc2
               WHERE oc2.lasyncro_order_id = o.lasyncro_order_id
                 AND oc2.is_active = true
                 AND oc2.constraint_type = 'customer'
                 AND oc2.block_type = 'incomplete_address'
             ) AS blocked_since`
          ),
          /** Order number the merchant recognises; null if never mapped. */
          trx.raw(
            `(
               SELECT eim.external_order_id
               FROM external_order_identity_map AS eim
               WHERE eim.lasyncro_order_id = o.lasyncro_order_id
                 AND eim.shop_id = o.shop_id
               LIMIT 1
             ) AS external_order_id`
          ),
        ])
        /**
         * Determinism, NOT prioritisation: longest-blocked first with the order
         * id as a total tie-breaker, so two identical requests return the same
         * sequence. No severity, revenue or recommendation weighting is applied
         * — this endpoint ranks nothing.
         */
        .orderByRaw('blocked_since ASC NULLS LAST, o.lasyncro_order_id ASC')
    );

    /**
     * UNPAGINATED, DELIBERATELY.
     * --------------------------
     * The session contract is "the merchant resolves every currently affected
     * order", so a page boundary would silently redefine membership. The result
     * is self-limiting: it is bounded by the number of orders currently holding
     * an active address block, which is the merchant's real outstanding work,
     * not the order table's size.
     */
    return res.status(200).json({ data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ADDRESS_RESOLUTION_ORDERS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch address resolution orders: ${message}`,
    });
  }
};
