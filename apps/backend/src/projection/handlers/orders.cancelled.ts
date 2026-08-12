// apps/backend/src/projection/handlers/orders.cancelled.ts

/**
 * ORDERS — CANCELLATION PROJECTION HANDLER (INV-BLOCK-10a)
 * ---------------------------------------------------------
 * Drives order_fulfillment_status → 'cancelled' via the ingestion
 * service, which owns the monotonic transition guard. Cancellation is
 * the one status allowed to override any prior state
 * (orderFulfillmentIngestion.service.ts — precedence guard).
 *
 * SCOPE.
 * Commercial status is ingested here. Physical unwind — releasing
 * reservations and routing already-picked units to the Problem Center —
 * is delegated to cancellationUnwind.service.ts (INV-BLOCK-10b). This
 * handler is the only observer of orders/cancelled (projection.registry
 * .ts:90), so the call sits here rather than in a queue job.
 *
 * Unpicked reservations are reversed with reservation_release movements.
 * Already-picked units remain inventory-neutral here and are routed through
 * Problem Center; their physical recovery is deferred to supervisor
 * resolution, per INV-PC-01.
 *
 * Once status is 'cancelled', the release pool excludes the order:
 * pickBatch.service.ts filters whereIn(status, ['pending','processing']).
 */
import { Knex } from 'knex';
import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';
import orderFulfillmentIngestionService from '../../services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { unwindCancelledOrder } from '../../services/wms/cancellationUnwind.service.js';
import { debugLog } from '../projection.utils.js';

export async function handleOrdersCancelled({
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
    trx // CRITICAL: must use projection transaction for consistent read
  );

  if (!lasyncroOrderId) {
    /**
     * A cancellation for an order laSyncro has never ingested is inert,
     * not fatal — the order may predate installation. Must stay
     * observable: a silent skip here means the order can still ship.
     */
    console.error('[PROJECTION_ORDER_CANCELLED_MISSING_ORDER_ID]', {
      domain_event_id,
      externalOrderId,
      shopId: domainEvent.shop_id,
    });
    return;
  }

  await orderFulfillmentIngestionService.ingestStatus(
    {
      lasyncroOrderId,
      shopId: domainEvent.shop_id,
      status: 'cancelled',
      canonicalEventTime,
    },
    trx
  );

  await unwindCancelledOrder(trx, domainEvent.shop_id, lasyncroOrderId);

  debugLog('[ORDER_CANCELLED_INGESTED]', {
    lasyncroOrderId,
    domain_event_id,
    eventTime: canonicalEventTime,
  });
}