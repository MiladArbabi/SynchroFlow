import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

/**
 * ORDER CONSTRAINT PROJECTION
 * ---------------------------
 * Maintains lifecycle of constraint events.
 *
 * Event model:
 * - open event when constraint detected
 * - close event when constraint resolved
 *
 * Deterministic guarantees:
 * - append-only lifecycle
 * - event-time anchored
 */

const CONSTRAINT_EVENT_NAMESPACE =
  'a9b7c6d4-4f8a-4c1b-b7b6-1c9a2e5d7f91';

export async function projectOrderConstraints(
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
    throw new Error('[CONSTRAINT_PROJECTION_INVARIANT] fulfillment status missing');
  }

  const constraintMap = {
    inventory: !!ofs.inventory_block_type,
    customer: !!ofs.customer_block_type,
    operational: !!ofs.operational_block_type,
  } as const;

  for (const [type, isActive] of Object.entries(constraintMap)) {

    const activeEvent = await trx('order_constraint_events')
      .where({
        lasyncro_order_id: orderId,
        constraint_type: type,
        is_active: true,
      })
      .first();

    if (isActive && !activeEvent) {

      const constraintEventId = uuidv5(
        `${type}:${orderId}:${aggregateVersion}`,
        CONSTRAINT_EVENT_NAMESPACE
      );

      await trx('order_constraint_events').insert({
        constraint_event_id: constraintEventId,
        lasyncro_order_id: orderId,
        shop_id: shopId,
        constraint_type: type,
        started_at: eventAnchor,
        resolved_at: null,
        is_active: true,
      });

    }

    if (!isActive && activeEvent) {

      await trx('order_constraint_events')
        .where({
          constraint_event_id: activeEvent.constraint_event_id
        })
        .update({
          resolved_at: eventAnchor,
          is_active: false,
        });

    }
  }
}