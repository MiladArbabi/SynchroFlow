// apps/backend/src/projection/handlers/integration.sync_completed.ts

/**
 * PROJECTION — integration/sync_completed
 * ----------------------------------------
 * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 1.
 *
 * A genuinely empty, successfully-synced Shopify store must not remain
 * trapped in implicit FT_MINUS_ONE forever — orders/create never fires
 * for a zero-order store, so nothing else in the existing chain ever
 * advances lifecycle for it.
 *
 * This handler owns EXACTLY the zero-order entry path. It is a no-op
 * whenever:
 *   - a user_lifecycle_snapshot already exists for the shop (some other
 *     path — almost always orders.create — already anchored it), or
 *   - the shop's live order count is > 0 (orders.create's own
 *     INGESTION-DRIVEN block owns FT0 entry for populated stores; this
 *     handler must never race or duplicate it).
 *
 * Emitted only for an authoritative, non-PCD-limited sync completion —
 * see shopifyIntegrationStatus.service.ts, which is the sole emitter and
 * structurally excludes the PCD-fallback path.
 *
 * FirstInsightService and FT0CompletionService are intentionally never
 * called from this path — first insight has no meaning for a store with
 * no orders, and is decoupled from lifecycle progression by design.
 */
import { Knex } from 'knex';
import { resolveFoundingOwner } from '../../services/founding-owner.service.js';
import { materializeFT0Completion } from '../../services/ft0-completion-materializer.service.js';

export async function handleIntegrationSyncCompleted({
  domainEvent,
  domain_event_id,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {
  const shopId = domainEvent.shop_id;

  const existingSnapshot = await trx('user_lifecycle_snapshot')
    .where({ shop_id: shopId })
    .first('phase');

  if (existingSnapshot) {
    console.info('[SYNC_COMPLETED_NOOP_SNAPSHOT_EXISTS]', {
      shopId,
      phase: existingSnapshot.phase,
    });
    return;
  }

  const orderCountRow = await trx('orders')
    .where({ shop_id: shopId })
    .count<{ count: string }>('* as count')
    .first();

  const orderCount = Number(orderCountRow?.count ?? 0);

  if (orderCount > 0) {
    console.info('[SYNC_COMPLETED_NOOP_ORDERS_PRESENT]', {
      shopId,
      orderCount,
    });
    return;
  }

  const eventRow = await trx('domain_events')
    .where({ id: domain_event_id })
    .first();

  const eventTime = new Date(eventRow.event_time);

  const foundingOwnerUserId = await resolveFoundingOwner(shopId, trx);

  await materializeFT0Completion({
    shopId,
    trx,
    eventTime,
    completionReason: { orders: 0, source: 'integration/sync_completed' },
    foundingOwnerUserId,
  });

  console.info('[ZERO_ORDER_FT0_ENTRY_FROM_SYNC_COMPLETED]', {
    shopId,
    userId: foundingOwnerUserId,
  });
}
