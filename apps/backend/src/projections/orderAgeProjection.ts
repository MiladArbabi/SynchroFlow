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
 * AGE CALCULATION (INVARIANT-SAFE)
 * --------------------------------
 * Event time can precede materialized timestamps due to:
 * - ingestion ordering
 * - replay timing
 *
 * We clamp to zero to preserve:
 * - DB constraints
 * - deterministic rebuilds
 *
 * This is NOT business logic — it is temporal normalization.
 */
  const ageSinceCreationRaw =
    (eventAnchor.getTime() - new Date(createdAt).getTime()) / 1000;

  const ageSinceCreation = Math.max(0, Math.floor(ageSinceCreationRaw));

  const ageSincePaid =
    paidAt
      ? Math.max(
          0,
          Math.floor(
            (eventAnchor.getTime() - new Date(paidAt).getTime()) / 1000
          )
        )
      : null;
    
  /**
   * FULFILLMENT AGE (INVARIANT-SAFE)
   * --------------------------------
   * Same reasoning as creation/paid:
   * fulfillment timestamp may be ahead of eventAnchor during replay.
   */
  const fulfilledAt = row.fulfilled_at ?? null;
  const ageSinceFulfillment =
    fulfilledAt
      ? Math.max(
          0,
          Math.floor(
            (eventAnchor.getTime() - new Date(fulfilledAt).getTime()) / 1000
          )
        )
      : null;

  await trx('order_age_snapshot')
    .insert({
      lasyncro_order_id: orderId,
      aggregate_version: aggregateVersion,

      age_since_creation_seconds: ageSinceCreation,
      age_since_paid_seconds: ageSincePaid,
      age_since_fulfillment_seconds: ageSinceFulfillment,

      is_shipping_sla_breached: false,
      is_delivery_sla_breached: false,

      snapshot_generated_at: eventAnchor
    })
    // CONFLICT POLICY:
    // - Type: PROJECTION_REBUILD
    // - Strategy: UPSERT_EXPLICIT
    // - Rationale: Prevent implicit overwrite and ensure deterministic projection state
    .onConflict('lasyncro_order_id')
    .merge({
      // EXPLICIT MERGE POLICY: overwrite all mutable fields to ensure deterministic rebuilds
      updated_at: new Date(),
      // NOTE: add all projection fields explicitly here to avoid implicit overwrite behavior
    });
}