import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * ORDER CONSTRAINT RE-EVALUATION CLI
 * ----------------------------------
 * BL-01a.
 *
 * Emits orders/constraints_reevaluated for explicitly named orders so the
 * production projection worker re-runs the standard constraint/risk
 * orchestration against the CURRENT evaluators.
 *
 * Why this exists: constraints are only re-evaluated when an order receives
 * a domain event. An order that stops receiving events keeps whatever
 * block_type was written by whichever evaluator was live at the time —
 * permanently, even after that evaluator is changed or removed. The Order
 * Pool predicate excludes on is_active regardless of block_type, so such an
 * order is blocked forever with no supported path back.
 *
 * This CLI writes NO canonical data, resolves NO constraints, and asserts
 * NOTHING about the outcome. It appends an event and stops. If a block is
 * still legitimate the evaluator re-asserts it.
 *
 * Usage:
 *   --shop-id=<n>                     required
 *   --order-ids=<uuid,uuid,...>       required with --apply
 *   --apply                           default is dry-run
 *   --confirm=BL-01A                  required with --apply
 */

const shopArg = process.argv.find((arg) => arg.startsWith('--shop-id='));
const shopId = Number(shopArg?.split('=')[1] ?? '');

if (!Number.isInteger(shopId) || shopId <= 0) {
  throw new Error('Usage: --shop-id=<positive integer>');
}

const applyMode = process.argv.includes('--apply');

const orderIdsArg = process.argv.find((arg) => arg.startsWith('--order-ids='));
const confirmationArg = process.argv.find((arg) => arg.startsWith('--confirm='));

const requestedOrderIds = orderIdsArg
  ? [...new Set(orderIdsArg.split('=')[1].split(',').map((v) => v.trim()).filter(Boolean))].sort()
  : [];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (applyMode) {
  /**
   * APPLY SAFETY GATE
   * -----------------
   * Never permit broad "re-evaluate everything", implicit selection, or
   * accidental --apply. Exact audited order IDs plus the issue token only.
   */
  if (requestedOrderIds.length === 0 || requestedOrderIds.some((v) => !UUID_RE.test(v))) {
    throw new Error('[CONSTRAINT_REEVALUATION_APPLY_REQUIRES_ORDER_IDS]');
  }
  if (confirmationArg !== '--confirm=BL-01A') {
    throw new Error('[CONSTRAINT_REEVALUATION_APPLY_CONFIRMATION_REQUIRED]');
  }
}

const { withTenant } = await import('@lasyncro/backend-core/db.js');

const inspect = async (trx: any, orderIds: string[]) => {
  const scope = orderIds.length > 0;
  const orders = await trx('orders as o')
    .leftJoin('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .modify((qb: any) => { if (scope) qb.whereIn('o.lasyncro_order_id', orderIds); })
    .select(
      'o.lasyncro_order_id',
      'eim.external_order_id',
      'o.aggregate_version',
      'ofs.status as fulfillment_status',
    );

  const constraints = await trx('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oc.is_active', true)
    .modify((qb: any) => { if (scope) qb.whereIn('oc.lasyncro_order_id', orderIds); })
    .select('oc.lasyncro_order_id', 'oc.constraint_type', 'oc.block_type', 'oc.started_at');

  const batched = await trx('pick_batch_orders')
    .where('shop_id', shopId)
    .modify((qb: any) => { if (scope) qb.whereIn('lasyncro_order_id', orderIds); })
    .select('lasyncro_order_id');

  const batchedSet = new Set(batched.map((b: any) => b.lasyncro_order_id));

  return orders.map((o: any) => ({
    lasyncro_order_id: o.lasyncro_order_id,
    external_order_id: o.external_order_id ?? null,
    aggregate_version: o.aggregate_version,
    fulfillment_status: o.fulfillment_status ?? null,
    batched: batchedSet.has(o.lasyncro_order_id),
    active_constraints: constraints
      .filter((c: any) => c.lasyncro_order_id === o.lasyncro_order_id)
      .map((c: any) => ({
        type: c.constraint_type,
        block_type: c.block_type,
        started_at: c.started_at,
      })),
  }));
};

if (applyMode) {
  /**
   * APPLY
   * -----
   * One transaction. Appends the re-evaluation event per order and commits.
   *
   * Do NOT call processDomainEvent() here. The authoritative DB projection
   * worker consumes committed domain events in strict cursor order.
   */
  const result = await withTenant(shopId, async (trx: any) => {
    const candidates = await inspect(trx, requestedOrderIds);

    const missing = requestedOrderIds.filter(
      (id) => !candidates.some((c: any) => c.lasyncro_order_id === id),
    );
    if (missing.length > 0) {
      throw new Error(`[CONSTRAINT_REEVALUATION_ORDER_NOT_FOUND] ${missing.join(',')}`);
    }

    const withoutExternalId = candidates.filter((c: any) => !c.external_order_id);
    if (withoutExternalId.length > 0) {
      throw new Error(
        `[CONSTRAINT_REEVALUATION_MISSING_EXTERNAL_ID] ${withoutExternalId
          .map((c: any) => c.lasyncro_order_id)
          .join(',')}`,
      );
    }

    const emittedAt = new Date();
    const epoch = emittedAt.getTime();
    const emitted: Array<{ lasyncro_order_id: string; domain_event_id: number }> = [];

    for (const candidate of candidates) {
      const inserted = await trx('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'orders/constraints_reevaluated',
          event_payload: {
            id: candidate.external_order_id,
            lasyncro_order_id: candidate.lasyncro_order_id,
            reason: 'BL-01A',
          },
          event_time: emittedAt,
          event_version: 1,
          external_event_id: `constraints_reevaluate:${candidate.lasyncro_order_id}:${epoch}`,
        })
        .returning('id');

      if (inserted.length !== 1) {
        throw new Error(
          `[CONSTRAINT_REEVALUATION_EVENT_INSERT_COUNT] order=${candidate.lasyncro_order_id}`,
        );
      }

      emitted.push({
        lasyncro_order_id: candidate.lasyncro_order_id,
        domain_event_id: Number(inserted[0].id ?? inserted[0]),
      });
    }

    return { requested: requestedOrderIds.length, emitted };
  });

  console.log(JSON.stringify({ mode: 'apply', shopId, ...result }, null, 2));
  console.log('CONSTRAINT_REEVALUATION_PROJECTION=queued-via-domain-events');
  process.exit(0);
}

const plan = await withTenant(shopId, async (trx: any) => inspect(trx, requestedOrderIds));

console.log(
  JSON.stringify(
    {
      mode: 'dry-run',
      shopId,
      scope: requestedOrderIds.length > 0 ? 'explicit-order-ids' : 'all-shop-orders',
      candidateCount: plan.length,
      candidates: plan,
    },
    null,
    2,
  ),
);
process.exit(0);