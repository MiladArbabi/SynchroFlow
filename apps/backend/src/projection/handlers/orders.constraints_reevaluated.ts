import { Knex } from 'knex';

/**
 * ORDER CONSTRAINTS RE-EVALUATED
 * ------------------------------
 * BL-01a.
 *
 * When a constraint evaluator changes, orders that receive no further
 * domain events are never re-evaluated. Their order_constraints rows keep
 * a block_type the current evaluator can no longer produce, and the Order
 * Pool predicate in wms.controller.ts excludes them forever.
 *
 * Concrete case: 7 shop-1 orders carried operational:sla_breach written by
 * the pre-2026-06-20 evaluator (9e13b62f). The current evaluator derives
 * operational blocks from unresolved pick_exceptions only — and after
 * BL-01b it derives none at all — but no event ever arrived to re-evaluate
 * these orders, so they stayed blocked.
 *
 * This handler intentionally performs NO data mutation. Like
 * orders/canonical_data_repaired, its sole purpose is to be a real
 * order-entity event so projectDomainEventCore runs:
 *
 *   age -> constraint evaluation -> constraint projection -> risk
 *       -> snapshot scheduling
 *
 * It asserts nothing about the outcome. If a block is still legitimate the
 * evaluator will re-assert it; if it is not, normal machinery resolves it.
 * Constraints are never cleared directly.
 */
export async function handleOrdersConstraintsReevaluated({
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
    console.error('[CONSTRAINTS_REEVALUATED_INVALID_ORDER_ID]', {
      domain_event_id,
      externalOrderId,
    });
    throw new Error('[CONSTRAINTS_REEVALUATED_INVALID_ORDER_ID]');
  }
}