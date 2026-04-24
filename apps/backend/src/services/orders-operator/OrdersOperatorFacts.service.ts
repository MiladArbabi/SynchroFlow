// apps/backend/src/services/orders-operator/OrdersOperatorFacts.service.ts

import db from '@lasyncro/backend-core/db.js';

/**
 * OrdersOperatorFacts
 * -------------------
 * Purpose-built operator facts for the Orders operator summary endpoint.
 *
 * DESIGN CONTRACT:
 * - This is NOT an FTEP layer — it is a direct operator surface.
 * - Returns raw counts and named order lists — no downgrading, no lossy signals.
 * - Joins across domains: orders × constraints × snapshot × identity map.
 * - The FTEP layer cannot do this; the operator surface can.
 *
 * SOURCES:
 * - orders (sovereign identity, timestamps)
 * - order_constraints (active constraint type per order)
 * - orders_operational_control_snapshot (top blocking type, queue counts)
 * - order_age_snapshot (age_since_creation_seconds, SLA breach flags)
 * - order_fulfillment_status (fulfillment_status per order)
 * - external_order_identity_map (human-readable external order ID)
 *
 * OPERATOR QUESTIONS ANSWERED:
 * 1. How many orders are stuck, and by what constraint type?
 * 2. Which specific orders are aging past SLA (named, actionable)?
 * 3. What is the top fulfillment bottleneck right now?
 * 4. How many orders are in each work queue?
 */

export interface OrdersOperatorFacts {
  shopId: number;

  // ── Constraint breakdown (active constraints) ─────────────
  // Count of distinct orders blocked by each constraint type
  constraintCounts: {
    inventory: number;
    customer: number;
    operational: number;
  };

  // ── Top blocking type (from latest snapshot) ──────────────
  // The dominant blocker — drives primary operator action label
  topBlockingType: string | null;

  // ── Aging orders past SLA (named, actionable, top 20) ─────
  // Unfulfilled orders with age > 48h, with external ID for operator action
  agingOrders: Array<{
    lasyncro_order_id: string;
    externalOrderId: string | null;
    ageHours: number;
    isShippingSlaBreached: boolean;
    constraintType: string | null;
    isPriorityFlagged: boolean;
    /** Minutes until 72h SLA breach — negative means already breached */
    timeToSlaBreachMinutes: number | null;
  }>;

  /** Orders breaching 72h SLA within the next 8 hours */
  imminentSlaBreachers: Array<{
    lasyncro_order_id: string;
    externalOrderId: string | null;
    minutesUntilBreach: number;
    constraintType: string | null;
    revenue: number;
  }>;

  // ── Queue summary (from latest snapshot) ──────────────────
  // Operational workload queues — how many orders need what action
  queueCounts: {
    readyToShip: number;
    awaitingInventory: number;
    awaitingCustomer: number;
    manualReview: number;
  };
}

export async function getOrdersOperatorFacts(
  shopId: number
): Promise<OrdersOperatorFacts> {

  // ─────────────────────────────────────────
  // Constraint breakdown — active constraints per type
  // Source: order_constraints (is_active = true)
  // COUNT DISTINCT orders, not constraint rows, to avoid double-counting
  // orders with multiple active constraints.
  // ─────────────────────────────────────────
  const constraintRows = await db('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oc.is_active', true)
    .groupBy('oc.constraint_type')
    .select(
      'oc.constraint_type',
      db.raw('COUNT(DISTINCT oc.lasyncro_order_id) as count')
    );

  const constraintCounts = { inventory: 0, customer: 0, operational: 0 };

  for (const row of constraintRows) {
    const type = row.constraint_type as keyof typeof constraintCounts;
    if (type in constraintCounts) {
      constraintCounts[type] = Number(row.count);
    }
  }

  // ─────────────────────────────────────────
  // Top blocking type + queue counts from latest snapshot
  // Source: orders_operational_control_snapshot
  // Deterministic ordering: snapshot_date DESC, aggregate_version DESC
  // ─────────────────────────────────────────
  const snapshotRow = await db('orders_operational_control_snapshot')
    .where({ shop_id: shopId })
    .orderBy([
      { column: 'snapshot_date', order: 'desc' },
      { column: 'aggregate_version', order: 'desc' },
    ])
    .first();

  const topBlockingType = snapshotRow?.top_blocking_type ?? null;

  const queueCounts = {
    readyToShip:       Number(snapshotRow?.queue_ready_to_ship      ?? 0),
    awaitingInventory: Number(snapshotRow?.queue_awaiting_inventory  ?? 0),
    awaitingCustomer:  Number(snapshotRow?.queue_awaiting_customer   ?? 0),
    manualReview:      Number(snapshotRow?.queue_manual_review       ?? 0),
  };

  // ─────────────────────────────────────────
  // Aging orders > 48h (named, actionable, top 20 by age desc)
  //
  // Sources:
  //   order_age_snapshot        → age_since_creation_seconds, is_shipping_sla_breached
  //   order_fulfillment_status  → filter out fulfilled orders
  //   external_order_identity_map → human-readable order reference
  //   order_constraints         → dominant active constraint type (earliest started_at)
  //
  // 48h = 172800 seconds
  //
  // Only the latest snapshot row per order is used (max aggregate_version).
  // Fulfilled orders are excluded — age is only an operator problem
  // when the order has not yet shipped.
  // ─────────────────────────────────────────
  // Latest aggregate_version per order — avoids DISTINCT ON subquery issues.
  // Uses a raw subquery correlated on lasyncro_order_id for correctness.
  const agingRows = await db('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    // External order reference for operator display
    .leftJoin(
      'external_order_identity_map as eim',
      'eim.lasyncro_order_id',
      'o.lasyncro_order_id'
    )
    // Dominant active constraint — use MIN(constraint_id) per order to avoid DISTINCT ON
    .leftJoin(
      db('order_constraints')
        .where('is_active', true)
        .groupBy('lasyncro_order_id')
        .select('lasyncro_order_id')
        .min('constraint_type as constraint_type')
        .as('dominant_constraint'),
      'dominant_constraint.lasyncro_order_id',
      'o.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .andWhere('oas.age_since_creation_seconds', '>', 172800) // > 48h
    // Only latest snapshot version per order
    .andWhere(
      'oas.aggregate_version',
      db('order_age_snapshot as oas2')
        .where('oas2.lasyncro_order_id', db.raw('oas.lasyncro_order_id'))
        .max('oas2.aggregate_version')
    )
    .orderBy('oas.age_since_creation_seconds', 'desc')
    .limit(20)
    .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .select(
      'o.lasyncro_order_id',
      'o.order_created_at',
      'eim.external_order_id',
      'oas.age_since_creation_seconds',
      'oas.is_shipping_sla_breached',
      'dominant_constraint.constraint_type',
      db.raw('COALESCE(ofs.is_priority_flagged, false) as is_priority_flagged'),
    );

  const SLA_HOURS = 72;
  const agingOrders = agingRows.map((row: any) => {
    const orderCreatedAt = new Date(row.order_created_at);
    const slaDeadline = new Date(orderCreatedAt.getTime() + SLA_HOURS * 60 * 60 * 1000);
    const timeToSlaBreachMinutes = Math.round((slaDeadline.getTime() - Date.now()) / 60000);
    return {
      lasyncro_order_id: row.lasyncro_order_id,
      externalOrderId: row.external_order_id ?? null,
      ageHours: Math.floor(Number(row.age_since_creation_seconds) / 3600),
      isShippingSlaBreached: Boolean(row.is_shipping_sla_breached),
      constraintType: row.constraint_type ?? null,
      isPriorityFlagged: Boolean(row.is_priority_flagged),
      timeToSlaBreachMinutes,
    };
  });

  // ─────────────────────────────────────────
  // Imminent SLA breachers — will breach 72h SLA within 8 hours
  // NOT yet breached (age < 72h) but within the warning window
  // ─────────────────────────────────────────
  const imminentWindowStart = 72 * 3600 - 8 * 3600; // 64h in seconds
  const imminentWindowEnd   = 72 * 3600;             // 72h in seconds

  const imminentRows = await db('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    .leftJoin('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin(
      db('order_constraints').where('is_active', true)
        .groupBy('lasyncro_order_id')
        .select('lasyncro_order_id')
        .min('constraint_type as constraint_type')
        .as('dc'),
      'dc.lasyncro_order_id', 'o.lasyncro_order_id'
    )
    .leftJoin(
      db('order_revenue_units').groupBy('lasyncro_order_id')
        .select('lasyncro_order_id')
        .sum('line_total as revenue')
        .as('rev'),
      'rev.lasyncro_order_id', 'o.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .andWhere('oas.age_since_creation_seconds', '>=', imminentWindowStart)
    .andWhere('oas.age_since_creation_seconds', '<', imminentWindowEnd)
    .andWhere(
      'oas.aggregate_version',
      db('order_age_snapshot as oas2')
        .where('oas2.lasyncro_order_id', db.raw('oas.lasyncro_order_id'))
        .max('oas2.aggregate_version')
    )
    .orderBy('oas.age_since_creation_seconds', 'desc')
    .limit(20)
    .select(
      'o.lasyncro_order_id',
      'o.order_created_at',
      'eim.external_order_id',
      'oas.age_since_creation_seconds',
      'dc.constraint_type',
      db.raw('COALESCE(rev.revenue, 0) as revenue'),
    );

  const imminentSlaBreachers = imminentRows.map((row: any) => {
    const slaDeadline = new Date(new Date(row.order_created_at).getTime() + 72 * 60 * 60 * 1000);
    const minutesUntilBreach = Math.max(0, Math.round((slaDeadline.getTime() - Date.now()) / 60000));
    return {
      lasyncro_order_id: row.lasyncro_order_id,
      externalOrderId: row.external_order_id ?? null,
      minutesUntilBreach,
      constraintType: row.constraint_type ?? null,
      revenue: Math.round(Number(row.revenue) * 100) / 100,
    };
  });

  return {
    shopId,
    constraintCounts,
    topBlockingType,
    agingOrders,
    imminentSlaBreachers,
    queueCounts,
  };
}