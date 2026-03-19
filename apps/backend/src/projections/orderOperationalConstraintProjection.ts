import { Knex } from 'knex';

/**
 * ORDER OPERATIONAL CONSTRAINT PROJECTION
 * ---------------------------------------
 * Detects SLA breaches in fulfillment.
 *
 * Source of truth:
 * - order_fulfillment_status
 * - order_age_snapshot
 * - shop_operational_settings
 *
 * Deterministic:
 * - rebuild-safe
 * - no side effects
 */
export async function projectOrderOperationalConstraints(
  trx: Knex.Transaction,
  orderIds: string[],
  shopId: number
): Promise<void> {

  if (orderIds.length === 0) return;

  const shopSettings = await trx('shop_operational_settings')
    .where({ shop_id: shopId })
    .first();

  const slaHours = shopSettings?.fulfillment_sla_hours ?? 24;
  const slaSeconds = slaHours * 3600;

  /**
   * SOURCE OF TRUTH ALIGNMENT
   * -------------------------
   * Projection MUST NOT re-implement constraint logic.
   *
   * Instead, it derives block type ONLY from
   * deterministic state already computed:
   * - age_since_paid_seconds
   * - fulfillment status
   *
   * This keeps projection aligned with evaluator logic.
   */
  const rows = await trx('order_fulfillment_status as ofs')
    .join('order_age_snapshot as oas', 'oas.lasyncro_order_id', 'ofs.lasyncro_order_id')
    .select(
      'ofs.lasyncro_order_id',
      'ofs.status',
      'oas.age_since_paid_seconds'
    )
    .whereIn('ofs.lasyncro_order_id', orderIds);

  const blockedIds = new Set(
    rows
      .filter(r =>
        r.status === 'pending' &&
        Number(r.age_since_paid_seconds ?? 0) >= slaSeconds
      )
      .map(r => r.lasyncro_order_id)
  );

  for (const orderId of orderIds) {
    const blockType = blockedIds.has(orderId)
      ? 'fulfillment_sla_breach'
      : null;

    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .update({
        operational_block_type: blockType
      });
  }

  console.debug('[operational_constraint_projection.completed]', {
    evaluated_orders: orderIds.length,
    blocked: blockedIds.size,
    slaHours
  });
}