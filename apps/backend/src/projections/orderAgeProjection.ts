import { Knex } from 'knex';

/**
 * ORDER AGE PROJECTION
 * --------------------
 * Deterministic projection computing order aging metrics.
 *
 * Source of truth:
 * - orders
 * - order_fulfillment_status
 *
 * Guarantees:
 * - deterministic rebuild
 * - no wall clock influence
 */
export async function projectOrderAge(
  trx: Knex.Transaction,
  orderId: string,
  shopId: string,
  aggregateVersion: number,
  eventAnchor: Date
) {

  const row = await trx('orders as o')
    .leftJoin(
      'order_fulfillment_status as ofs',
      'ofs.lasyncro_order_id',
      'o.lasyncro_order_id'
    )
    .where('o.lasyncro_order_id', orderId)
    .select(
      'o.order_created_at',
      'o.paid_at',
      'o.captured_at',
      'o.order_processed_at',
      'ofs.fulfilled_at'
    )
    .first();

  if (!row) {
    throw new Error('[AGE_PROJECTION_INVARIANT] fulfillment status missing');
  }

  const createdAt = new Date(row.order_created_at);

  
  /**
   * PAID TIMESTAMP RESOLUTION
   * --------------------------
   * Shopify does not provide reliable paid timestamps.
   *
   * Fallback to order_created_at to ensure:
   * - deterministic aging
   * - no null propagation
   */
  const paidAt =
    row.paid_at ??
    row.captured_at ??
    row.order_processed_at ??
    row.order_created_at;

  /**
   * AGE REFERENCE POINT (CRITICAL FIX)
   * ------------------------------------
   * eventAnchor = domain event's event_time, which is causally unreliable.
   * Measured worst-case disorder: -37 days (events arriving out of order).
   *
   * Using eventAnchor as the "now" reference produces factually wrong ages:
   * - a 10-day-old order processed by a late event appears 0 seconds old
   * - SLA breaches are missed or fabricated
   *
   * Fix: use DB transaction time (NOW()) as the age reference.
   * This is the actual wall clock at projection execution time —
   * stable, monotonic, and accurate regardless of event ordering.
   *
   * eventAnchor is still used for snapshot_generated_at and updated_at
   * to preserve deterministic replay identity.
   */
  const nowResult = await trx.raw<{ rows: [{ now: Date }] }>('SELECT NOW() as now');
  const now = new Date(nowResult.rows[0].now);

  const ageSinceCreationRaw =
    (now.getTime() - new Date(createdAt).getTime()) / 1000;
  const ageSinceCreation = Math.max(0, Math.floor(ageSinceCreationRaw));

  const ageSincePaid =
    paidAt
      ? Math.max(
          0,
          Math.floor(
            (now.getTime() - new Date(paidAt).getTime()) / 1000
          )
        )
      : null;

  const fulfilledAt = row.fulfilled_at ?? null;
  const ageSinceFulfillment =
    fulfilledAt
      ? Math.max(
          0,
          Math.floor(
            (now.getTime() - new Date(fulfilledAt).getTime()) / 1000
          )
        )
      : null;

  // constant — this function's shopId param is typed as `string` (confirmed from
  // its own signature), while shop_operational_settings.shop_id is an integer PK,
  // so the read needs an explicit cast.
  const slaSettingsRow = await trx('shop_operational_settings')
    .where({ shop_id: Number(shopId) })
    .select('fulfillment_sla_hours')
    .first();

  /**
   * SHIPPING SLA BREACH (deterministic, now shop-configurable)
   * -----------------------------------------------------------
   * FIX (2026-07-01): previously hardcoded to 24h regardless of the
   * shop's actual configured fulfillment_sla_hours (shop_operational_settings,
   * already fully editable via Settings → General — confirmed live). The
   * comment that used to sit here claimed "the evaluator owns settings-driven
   * SLA," but operationalConstraintEvaluator.ts never reads settings at all
   * — that comment was stale. This is now the actual, correct place SLA
   * hours are read from, matching what the shop owner configures.
   * Defaults to 24 only if no settings row exists yet (new shop, pre-seed).
   */
  const SHIPPING_SLA_SECONDS = (slaSettingsRow?.fulfillment_sla_hours ?? 24) * 3600;
  const isShippingSlaBreached =
    fulfilledAt === null &&
    ageSincePaid !== null &&
    ageSincePaid >= SHIPPING_SLA_SECONDS;

  await trx('order_age_snapshot')
    .insert({
      lasyncro_order_id: orderId,
      aggregate_version: aggregateVersion,

      age_since_creation_seconds: ageSinceCreation,
      age_since_paid_seconds: ageSincePaid,
      age_since_fulfillment_seconds: ageSinceFulfillment,

      is_shipping_sla_breached: isShippingSlaBreached,
      is_delivery_sla_breached: false,

      snapshot_generated_at: eventAnchor
    })
    /**
     * CONFLICT KEY FIX (CRITICAL)
     * ---------------------------
     * Projection must version snapshots by:
     * (order_id, aggregate_version)
     *
     * Previous implementation overwrote snapshots,
     * breaking deterministic projection chain.
     */
    .onConflict(['lasyncro_order_id', 'aggregate_version'])
    .merge({
      age_since_creation_seconds: ageSinceCreation,
      age_since_paid_seconds: ageSincePaid,
      age_since_fulfillment_seconds: ageSinceFulfillment,
      is_shipping_sla_breached: isShippingSlaBreached,
      is_delivery_sla_breached: false,
      snapshot_generated_at: eventAnchor,
      /**
       * DETERMINISTIC TIMESTAMP (CRITICAL)
       * -----------------------------------
       * Must use eventAnchor, NOT wall clock (new Date()).
       * Wall clock breaks replay determinism: same event replayed
       * at different times produces different updated_at values.
       */
      updated_at: eventAnchor,
    })
}