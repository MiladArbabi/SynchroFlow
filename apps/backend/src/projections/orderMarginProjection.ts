import { Knex } from 'knex';

/**
 * ORDER MARGIN PROJECTION
 * -----------------------
 * Computes deterministic margin metrics derived from revenue units.
 *
 * Inputs:
 * - order_revenue_units
 * - order_revenue_units_net
 *
 * Guarantees:
 * - deterministic rebuild
 * - stable aggregation order
 */
export async function projectOrderMargin(
  trx: Knex.Transaction,
  orderId: string,
  shopId: string,
  aggregateVersion: number,
  eventAnchor: Date
) {

  const rows = await trx('order_revenue_units_net as runet')
    .join(
      'order_revenue_units as ru',
      'ru.lasyncro_revenue_unit_id',
      'runet.lasyncro_revenue_unit_id'
    )
    .where('runet.lasyncro_order_id', orderId)
    .orderBy('runet.lasyncro_revenue_unit_id', 'asc')
    .select(
      'runet.net_revenue',
      'runet.net_quantity',
      'ru.estimated_unit_cost',
      'ru.discount_amount',
      'ru.shipping_cost',
      'ru.payment_fee',
      'ru.fulfillment_cost'
    );

  let grossRevenue = 0;
  let estimatedCost = 0;

  for (const r of rows) {

    const revenue = Number(r.net_revenue ?? 0);
    const qty = Number(r.net_quantity ?? 0);
    const unitCost = Number(r.estimated_unit_cost ?? 0);

    const discount = Number(r.discount_amount ?? 0);
    const shipping = Number(r.shipping_cost ?? 0);
    const paymentFee = Number(r.payment_fee ?? 0);
    const fulfillmentCost = Number(r.fulfillment_cost ?? 0);

    if (Number.isFinite(revenue)) grossRevenue += revenue;
    if (Number.isFinite(qty) && Number.isFinite(unitCost)) {
      estimatedCost += qty * unitCost;
    }

    estimatedCost += discount + shipping + paymentFee + fulfillmentCost;
  }

  const grossMargin = grossRevenue - estimatedCost;
  const marginPct =
    grossRevenue > 0 ? grossMargin / grossRevenue : 0;

  await trx('order_margin_snapshot')
    .insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: aggregateVersion,
      gross_revenue: grossRevenue,
      estimated_cost: estimatedCost,
      gross_margin: grossMargin,
      margin_pct: marginPct,
      evaluated_at: eventAnchor
    })
    .onConflict('lasyncro_order_id')
    .merge();
}