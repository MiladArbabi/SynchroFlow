import { Knex } from 'knex';

/**
 * HISTORICAL CANONICAL ORDER DATA REPAIRED
 * -----------------------------------------
 * SHOPIFY-CANON-REST-02.
 *
 * Historical Shopify REST orders may have been projected before the
 * REST canonical mapper preserved shipping-address and line-item data.
 *
 * The repair service performs the canonical data mutation atomically
 * BEFORE emitting this event.
 *
 * This handler intentionally performs no data mutation. Its purpose is
 * to make `orders/canonical_data_repaired` a real order-entity event so
 * projectDomainEventCore runs the standard downstream orchestration:
 *
 *   age
 *   -> constraint evaluation
 *   -> constraint projection
 *   -> risk projection
 *   -> snapshot scheduling
 *
 * This mirrors the established orders/shipping_address_corrected pattern:
 * write first, then emit an order-domain event to re-evaluate derived state.
 */
export async function handleOrdersCanonicalDataRepaired({
  domainEvent,
  domain_event_id,
  canonicalEventTime: _canonicalEventTime,
  trx: _trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {
  const externalOrderId = domainEvent.event_payload?.id;

  if (
    externalOrderId === null ||
    externalOrderId === undefined ||
    !/^\d+$/.test(String(externalOrderId))
  ) {
    console.error('[CANONICAL_DATA_REPAIRED_INVALID_ORDER_ID]', {
      domain_event_id,
      externalOrderId,
    });

    throw new Error('[CANONICAL_DATA_REPAIRED_INVALID_ORDER_ID]');
  }
}
