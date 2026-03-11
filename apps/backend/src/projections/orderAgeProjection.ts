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
  eventAnchor: Date
) {

  const ofs = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  if (!ofs) {
    throw new Error('[AGE_PROJECTION_INVARIANT] fulfillment status missing');
  }

  const ageSinceCreation =
    Math.floor((eventAnchor.getTime() - new Date(ofs.created_at).getTime()) / 1000);

  const ageSincePaid =
    ofs.paid_at
      ? Math.floor((eventAnchor.getTime() - new Date(ofs.paid_at).getTime()) / 1000)
      : null;

  const ageSinceFulfillment =
    ofs.fulfilled_at
      ? Math.floor((eventAnchor.getTime() - new Date(ofs.fulfilled_at).getTime()) / 1000)
      : null;

  await trx('order_age_snapshot')
    .insert({
      lasyncro_order_id: orderId,
      age_since_creation_seconds: ageSinceCreation,
      age_since_paid_seconds: ageSincePaid,
      age_since_fulfillment_seconds: ageSinceFulfillment,
      evaluated_at: eventAnchor
    })
    .onConflict('lasyncro_order_id')
    .merge();
}