// apps/backend/src/projection/handlers/orders.shipping_address_corrected.ts
import { Knex } from 'knex';
import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';

/**
 * handleOrdersShippingAddressCorrected
 * ---------------------------------------
 * GH-1036 (2026-07-02): the write-side fix for OF-08's shipping-address
 * correction feature. Modeled directly on orders.paid.ts's handler —
 * minimal, resolves order by external ID, updates a couple fields,
 * bumps aggregate_version. Does NOT require the full canonical Shopify
 * order-node mapping that orders/create and orders/sync need (this
 * isn't a real Shopify webhook, it's an internal operator correction).
 *
 * Payload shape (set by orders.shipping-address.controller.ts):
 *   { id: string (external_order_id), shipping: {...} }
 *
 * This handler intentionally does NOT touch orders.shipping_* itself —
 * those columns are already written directly by
 * orders.shipping-address.controller.ts before this event is emitted
 * (same order as orders.paid.ts's real payment write happening at the
 * Shopify webhook layer, before this projection layer runs). This
 * handler's only job is to be a real, valid domain event that
 * triggers projectDomainEventCore's constraint/risk orchestration
 * block (isOrderEntityEvent gate) for this order — the actual DB
 * write already happened.
 */
export async function handleOrdersShippingAddressCorrected({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {
  const payload = domainEvent.event_payload as any;
  const externalOrderId = String(payload.id);

  const lasyncroOrderId = await resolveExternalOrderId(
    domainEvent.shop_id,
    'shopify',
    externalOrderId,
    trx
  );

  if (!lasyncroOrderId) {
    console.error('[PROJECTION_SHIPPING_ADDRESS_CORRECTED_MISSING_ORDER_ID]', {
      domain_event_id,
      externalOrderId,
    });
    return;
  }

  /**
   * aggregate_version was already bumped by
   * orders.shipping-address.controller.ts's direct write. This handler
   * does NOT bump it again — doing so would double-increment for a
   * single logical correction, and orchestration below reads whatever
   * version is currently on the row regardless.
   */
  await trx('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .update({
      updated_at: canonicalEventTime,
    });
}