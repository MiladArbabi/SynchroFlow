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
  shopId: string,
  aggregateVersion: number,
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
      shop_id: shopId,
      aggregate_version: aggregateVersion,

      is_inventory_blocked: isInventoryBlocked,
      is_customer_blocked: isCustomerBlocked,
      is_operational_blocked: isOperationalBlocked,

      is_at_risk: isInventoryBlocked || isCustomerBlocked || isOperationalBlocked,

      order_health_score: Math.round(healthScore * 100),

      evaluated_at: eventAnchor
    })
    .onConflict('lasyncro_order_id')
    .merge();
}