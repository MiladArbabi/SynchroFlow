// apps/backend/src/services/orders-operator/OrdersOperatorFacts.service.ts
import db, { withTenant } from '@lasyncro/backend-core/db.js';

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
    revenue: number;
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
  return withTenant(shopId, async (trx) => {

  // ─────────────────────────────────────────
  // Constraint breakdown — active constraints per type
  // Source: order_constraints (is_active = true)
  // COUNT DISTINCT orders, not constraint rows, to avoid double-counting
  // orders with multiple active constraints.
  // ─────────────────────────────────────────
  const constraintRows = await trx('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oc.is_active', true)
    .groupBy('oc.constraint_type')
    .select(
      'oc.constraint_type',
      db.raw('COUNT(DISTINCT oc.lasyncro_order_id) as count')
    );

  // Add near the top of the exported function, before constraintRows is queried
  // — shopId here is already typed `number`, no cast needed.
  const slaSettings = await trx('shop_operational_settings')
    .where({ shop_id: shopId })
    .select('fulfillment_sla_hours')
    .first();
  const slaHours = slaSettings?.fulfillment_sla_hours ?? 24;

  /**
   * UNIFIED THRESHOLD MODEL (2026-07-01)
   * --------------------------------------
   * Previously three independent hardcoded numbers computed what's
   * supposed to be one concept — "how urgent is this order" — and could
   * disagree with each other and with the real breach flag
   * (order_age_snapshot.is_shipping_sla_breached, which is anchored to
   * age_since_paid + fulfillment_sla_hours):
   *   - agingRows floor was a flat 172800s (48h), age_since_creation-anchored
   *   - imminentSlaBreachers deadline was a flat 72h, order_created_at-anchored
   * Both are now derived from the shop's real, configurable SLA setting,
   * and both are re-anchored to age_since_paid to match the actual breach
   * flag's own anchor — so these numbers can no longer contradict it.
   *
   * WATCH_FLOOR_SECONDS: half the SLA window — "worth surfacing before
   * it's actually late," not an arbitrary 48h.
   * IMMINENT_LEAD_SECONDS: fixed 4h lead window before the real breach
   * point, not a separate 72h/created_at deadline recomputation.
   */
  const SLA_SECONDS = slaHours * 3600;
  const WATCH_FLOOR_SECONDS = Math.floor(SLA_SECONDS * 0.5);
  const IMMINENT_LEAD_SECONDS = 4 * 3600;

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
  const snapshotRow = await trx('orders_operational_control_snapshot')
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
  const agingRows = await trx('order_age_snapshot as oas')
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
    .andWhereRaw(
      'GREATEST(oas.age_since_creation_seconds, COALESCE(oas.age_since_paid_seconds, 0)) > ?',
      [WATCH_FLOOR_SECONDS]
    )
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
    // FIX (2026-07-01): the comment above this block (line 135) already
    // documented the intent — "order_fulfillment_status → filter out
    // fulfilled orders" — but the filter itself was never written, only
    // the join (used solely for is_priority_flagged). Confirmed live:
    // already-fulfilled orders were showing up in the Watch/aging list
    // with a stale "SLA breach · Xd past" label, giving the false
    // impression something still needed action.
    .where((builder) => {
      builder.whereNull('ofs.status').orWhereNotIn('ofs.status', ['fulfilled']);
    })
    .leftJoin(
      db('order_revenue_units')
        .groupBy('lasyncro_order_id')
        .select('lasyncro_order_id')
        .sum('line_total as revenue')
        .as('rev'),
      'rev.lasyncro_order_id', 'o.lasyncro_order_id'
    )
    .select(
      'o.lasyncro_order_id',
      'o.order_created_at',
      'eim.external_order_id',
      'oas.age_since_creation_seconds',
      'oas.is_shipping_sla_breached',
      'dominant_constraint.constraint_type',
      db.raw('COALESCE(ofs.is_priority_flagged, false) as is_priority_flagged'),
      db.raw('COALESCE(rev.revenue, 0) as revenue'),
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
      revenue: Math.round(Number(row.revenue) * 100) / 100,
      timeToSlaBreachMinutes,
    };
  });

  const imminentRows = await trx('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    // ...existing joins unchanged...
    // FIX: re-anchor to age_since_paid_seconds + SLA_SECONDS, matching the
    // real breach flag's own definition — was order_created_at + flat 72h.
    .andWhere('oas.age_since_paid_seconds', '>', SLA_SECONDS - IMMINENT_LEAD_SECONDS)
    .andWhere('oas.age_since_paid_seconds', '<=', SLA_SECONDS)
    .andWhere('oas.is_shipping_sla_breached', false)
    // ...existing ordering/limit/select unchanged...

  const imminentSlaBreachers = imminentRows.map((row: any) => {
    const secondsUntilBreach = SLA_SECONDS - Number(row.age_since_paid_seconds);
    const minutesUntilBreach = Math.max(0, Math.round(secondsUntilBreach / 60));
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
  })
}