import { Knex } from 'knex';

/**
 * ORDER RISK PROJECTION
 * ---------------------
 * Computes operational risk indicators for an order.
 *
 * Deterministic inputs:
 * - order_fulfillment_status
 * - order_age_snapshot
 *
 * Guarantees:
 * - deterministic rebuild
 * - no wall clock influence
 */
export async function projectOrderRisk(
  trx: Knex.Transaction,
  orderId: string,
  eventAnchor: Date
) {

  const ofs = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  if (!ofs) {
    throw new Error('[RISK_PROJECTION_INVARIANT] fulfillment status missing');
  }

  const isInventoryBlocked = !!ofs.inventory_block_type;
  const isCustomerBlocked = !!ofs.customer_block_type;
  const isOperationalBlocked = !!ofs.operational_block_type;

  let healthScore = 1;

  if (isCustomerBlocked) healthScore -= 0.4;
  if (isInventoryBlocked) healthScore -= 0.2;
  if (isOperationalBlocked) healthScore -= 0.2;

  if (healthScore < 0) healthScore = 0;

  await trx('order_risk_snapshot')
    .insert({
      lasyncro_order_id: orderId,
      inventory_blocked: isInventoryBlocked,
      customer_blocked: isCustomerBlocked,
      operational_blocked: isOperationalBlocked,
      health_score: healthScore,
      evaluated_at: eventAnchor
    })
    .onConflict('lasyncro_order_id')
    .merge();
}