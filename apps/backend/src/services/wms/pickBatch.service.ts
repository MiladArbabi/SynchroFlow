import { currentFulfillmentSlaSql } from '../orders/fulfillmentSla.service.js';
// apps/backend/src/services/wms/pickBatch.service.ts
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { dispatchNotification } from '../notifications/notificationDispatch.service.js';
import { fireBatchReleasedAlert } from './wmsAlerts.service.js';
import { reserveBatchInventory } from './batchReservation.service.js';
import {
  readReleaseCapacity,
  sumReleaseCapacityByVariant,
} from '../inventory/releaseCapacity.service.js';
import { evaluateOrderConstraints } from '../constraints/constraintEngine.js';
import { projectOrderConstraints } from '../../projections/orderConstraintProjection.js';
import { generateWmsBarcode } from './wmsOrderBarcode.service.js';

/**
 * PICK BATCH SERVICE (WM-07)
 * --------------------------
 * Assembles and releases pick batches from the order pool.
 *
 * Rules:
 * - Full orders only — no split orders across batches
 * - Orders eligible: fulfillment_status IN ('pending', 'processing')
 * - Orders excluded: already assigned to an active pick_batch_orders row
 * - Batch size: up to max_batch_line_items (from shop_wms_settings)
 * - Batch may release below ceiling
 * - release_trigger: 'auto' | 'manual'
 * - released_by: null for auto, user id for manual
 *
 * Caller must operate within a transaction with tenant set:
 *   SET LOCAL "app.current_tenant" = '{shopId}'
 */

/**
 * SHOP-REVIEW-ORDER-POOL-READINESS-09 — structural release-readiness invariant.
 * ----------------------------------------------------------------------------
 * An order is structurally release-eligible only when it has at least one
 * USABLE WMS LINE: an `order_line_items` row with `quantity > 0` and a
 * non-null `lasyncro_variant_id`. SKU is deliberately NOT part of the test —
 * a valid mapped variant with `sku = null` is supported. Nothing is
 * fabricated; this predicate only ever excludes.
 *
 * This exact SQL is shared verbatim by the three authoritative gates so they
 * cannot drift:
 *   1. GET /api/v1/wms/order-pool               — pool rows
 *   2. GET /api/v1/wms/order-pool               — ready_for_release_count FILTER
 *   3. releaseBatch() eligibleOrders            — server-side Release All / greedy fill
 *
 * All three outer queries alias `orders` as `o`, so the correlation column is
 * a fixed code literal (`o.lasyncro_order_id`) — never an interpolated value.
 * `order_line_items(lasyncro_order_id)` is indexed (migration 0005), so this
 * stays an index-only EXISTS probe.
 */
export const HAS_USABLE_WMS_LINE_SQL = `EXISTS (
  SELECT 1
  FROM order_line_items li
  WHERE li.lasyncro_order_id = o.lasyncro_order_id
    AND li.quantity > 0
    AND li.lasyncro_variant_id IS NOT NULL
)`;

/**
 * SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10 (Slice B, PART 9) — fail-closed
 * on partially-mapped Shopify orders.
 * ----------------------------------------------------------------------------
 * An order with an unresolved `order_intake_exceptions` row cannot be
 * represented as a fully warehouse-executable order (SOURCE_NON_WMS —
 * NO_USABLE_WMS_LINES or PARTIALLY_MAPPED). There is no product contract for a
 * batch fulfilling only a hidden subset of a Shopify order, so such an order
 * is NOT READY. Applied verbatim alongside HAS_USABLE_WMS_LINE_SQL in the same
 * three authoritative gates (pool rows, ready_for_release_count, eligibleOrders)
 * so the predicate cannot drift. Same `o` alias; `order_intake_exceptions`
 * is keyed/indexed by shop + resolved_at.
 */
export const NO_ACTIVE_INTAKE_EXCEPTION_SQL = `NOT EXISTS (
  SELECT 1
  FROM order_intake_exceptions oie
  WHERE oie.lasyncro_order_id = o.lasyncro_order_id
    AND oie.resolved_at IS NULL
)`;

export type SkippedReleaseOrderReason =
  | 'blocked'
  | 'already_batched'
  | 'status_changed'
  | 'no_releasable_lines'
  | 'intake_exception'
  | 'not_in_pool';

export interface SkippedReleaseOrder {
  order_id: string;
  external_order_id: string | null;
  reason: SkippedReleaseOrderReason;
  label: string;
}

/**
 * FLOW-INVENTORY-TRIGGER-GAP-01
 * -----------------------------
 * An order that release found unsatisfiable, whose constraints were
 * re-evaluated and persisted as a result. DISTINCT from skipped_orders:
 * every skipped_orders reason describes a fact that already existed in
 * the data before the release attempt (already batched, status changed,
 * not in pool, already blocked). This one is a state change CAUSED by
 * the release attempt — the order left the pool and entered Blocked
 * Orders during this call. Collapsing the two would tell the merchant
 * "N orders not released" without saying that some of them just moved.
 */
export interface NewlyBlockedOrder {
  order_id: string;
  external_order_id: string | null;
  block_type: string;
  label: string;
}

/**
 * FLOW-INVENTORY-TRIGGER-GAP-01: orders release found unsatisfiable and
 * moved to Blocked during this call. Distinct from skipped_orders, which
 * reports facts that already existed before the release attempt.
 */
export interface NewlyBlockedOrder {
  order_id: string;
  external_order_id: string | null;
  block_type: string;
  label: string;
}

export interface ReleaseBatchResult {
  pick_batch_id: string | null;
  order_count: number;
  total_line_items: number;
  total_units: number;
  skipped_orders: SkippedReleaseOrder[];
  newly_blocked_orders: NewlyBlockedOrder[];
}

const RELEASE_CONSTRAINT_LABELS: Record<string, string> = {
  operational: 'Overdue',
  inventory: 'Out of Stock',
  customer: 'Address Issue',
};

const getSkippedReleaseLabel = (
  reason: SkippedReleaseOrderReason,
  constraintType?: string | null
): string => {
  if (reason === 'blocked') {
    return constraintType ? RELEASE_CONSTRAINT_LABELS[constraintType] ?? 'Blocked' : 'Blocked';
  }

  if (reason === 'already_batched') return 'Already in a pick batch';
  if (reason === 'status_changed') return 'Status changed';
  if (reason === 'no_releasable_lines') return 'No releasable items';
  if (reason === 'intake_exception') return 'Needs review — intake exception';
  return 'Not in release pool';
};

export async function releaseBatch(
  trx: Knex.Transaction,
  shopId: number,
  trigger: 'auto' | 'manual',
  releasedBy: number | null,
  assignedOperatorId?: number | null,
  assignedPackerId?: number | null,
  /**
   * PRIORITY ORDER SELECTION (A2)
   * --------------------------------
   * Owner-selected orders locked in first before greedy fill.
   * All must be in the pool (constraint-free, unbatched).
   * Invalid IDs are silently skipped — greedy fill compensates.
   * Priority-flagged orders (is_priority_flagged=true) always
   * precede non-flagged orders in greedy fill even without explicit selection.
   * SLA-breached orders (order_age_snapshot.is_shipping_sla_breached — the
   * same 24h fulfillment_sla_hours threshold AL-01's alerts use, see
   * orderAgeProjection.ts) precede non-breached orders within each
   * priority-flag group. Manual flag always outranks automatic breach
   * status — see eligibleOrders query below for the full 3-key sort.
   */
  priorityOrderIds?: string[],
  /**
   * EXCLUSIVE SELECTION MODE (MOB-SMOKE-06b)
   * -----------------------------------------
   * When true and priorityOrderIds provided, skip greedy fill entirely.
   * Only the explicitly selected orders are batched — no pool fill.
   * Invalid IDs (not in pool) are silently skipped.
   * If no valid IDs remain after validation, returns null.
   */
  exclusive?: boolean,
): Promise<ReleaseBatchResult | null> {
  // 1. Load WMS settings for this shop
  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select('max_batch_line_items')
    .first();
  if (!settings) {
    console.error('[PICK_BATCH_SERVICE] shop_wms_settings missing', { shopId });
    throw new Error(`[PICK_BATCH_SERVICE] No WMS settings found for shop ${shopId}`);
  }
  const maxLineItems: number = settings.max_batch_line_items;

  // 2. Find eligible orders — constraint-free, unbatched, pending/processing.
  //    Sort: priority-flagged first, then SLA-breached, then oldest-first.
  //    latest_age_snapshot CTE matches sla.metrics.ts's established pattern —
  //    order_age_snapshot is append-only/versioned; DISTINCT ON +
  //    aggregate_version DESC guarantees one row per order. Without this,
  //    the join would multiply eligible rows and corrupt the greedy fill below.
  const slaSettings = await trx('shop_operational_settings').where({ shop_id: shopId }).first('fulfillment_sla_hours');
  const currentSla = currentFulfillmentSlaSql(slaSettings?.fulfillment_sla_hours);
  const eligibleOrdersQuery = trx
    .with('latest_age_snapshot', (qb) => {
      qb.from('order_age_snapshot as oas')
        .distinctOn('oas.lasyncro_order_id')
        .select('oas.lasyncro_order_id', 'oas.is_shipping_sla_breached')
        .orderBy('oas.lasyncro_order_id')
        .orderBy('oas.aggregate_version', 'desc');
    })
    .from('orders as o')
    .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
    .leftJoin('latest_age_snapshot as las', 'las.lasyncro_order_id', 'o.lasyncro_order_id')
    .whereNotExists(
      trx('order_constraints as oc')
        .where('oc.lasyncro_order_id', trx.raw('o.lasyncro_order_id'))
        .where('oc.is_active', true)
        .select(1)
    )
    .where('o.shop_id', shopId)
    .whereIn('ofs.status', ['pending', 'processing'])
    .whereNull('pbo.lasyncro_order_id')
    // SHOP-REVIEW-ORDER-POOL-READINESS-09: a structurally empty order (zero
    // usable WMS lines) must never be greedily selected or accepted from an
    // explicit priority_order_ids list. Defense-in-depth — the order-pool
    // query already excludes it, but releaseBatch is independently
    // authoritative because UI/pool state can be stale.
    .whereRaw(HAS_USABLE_WMS_LINE_SQL)
    // SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10 (PART 9): an order with an
    // unresolved intake exception (fully non-WMS or partially mapped) is not
    // fully executable — fail closed here too, consistently with the pool query.
    .whereRaw(NO_ACTIVE_INTAKE_EXCEPTION_SQL)
    .select('o.lasyncro_order_id', 'ofs.is_priority_flagged', trx.raw(`${currentSla.breached} as is_shipping_sla_breached`), trx.raw(`${currentSla.state} as sla_state`))
    .orderByRaw(`ofs.is_priority_flagged DESC, ${currentSla.rank} DESC, o.order_created_at ASC`);
  const eligibleOrders = await eligibleOrdersQuery.clone();
    

  // 3. Build ordered candidate list:
  //    a) Owner-selected priority orders (priorityOrderIds) — validated against pool
  //    b) Pool priority-flagged orders not already selected
  //    c) Remaining pool orders oldest-first
  const eligibleSet = new Set(eligibleOrders.map(o => o.lasyncro_order_id));
  const requestedPriorityIds = priorityOrderIds ?? [];
  const validPriorityIds = requestedPriorityIds.filter(id => eligibleSet.has(id));
  const invalidPriorityIds = requestedPriorityIds.filter(id => !eligibleSet.has(id));

  const skippedOrders: SkippedReleaseOrder[] = [];

  if (invalidPriorityIds.length > 0) {
    const latestActiveConstraint = trx('order_constraints')
      .distinctOn('lasyncro_order_id')
      .select('lasyncro_order_id', 'constraint_type', 'block_type')
      .where('is_active', true)
      .orderByRaw('lasyncro_order_id, started_at DESC NULLS LAST')
      .as('oc');

    const invalidRows = await trx('orders as o')
      .leftJoin('external_order_identity_map as eim', 'eim.lasyncro_order_id', 'o.lasyncro_order_id')
      .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
      .leftJoin('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'o.lasyncro_order_id')
      .leftJoin(latestActiveConstraint, 'oc.lasyncro_order_id', 'o.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .whereIn('o.lasyncro_order_id', invalidPriorityIds)
      .select(
        'o.lasyncro_order_id',
        'eim.external_order_id',
        'ofs.status',
        'pbo.pick_batch_id',
        'oc.constraint_type',
        'oc.block_type',
        // SHOP-REVIEW-ORDER-POOL-READINESS-09: lets the classifier distinguish
        // "order exists for this shop but has zero usable WMS lines" from a
        // generic not_in_pool. Same shared predicate as eligibleOrders.
        trx.raw(`${HAS_USABLE_WMS_LINE_SQL} as has_usable_wms_line`),
        // SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10: and "exists, has lines,
        // but a partially-mapped intake exception makes it unsafe to release".
        trx.raw(`${NO_ACTIVE_INTAKE_EXCEPTION_SQL} as has_no_active_intake_exception`)
      );

    const invalidById = new Map(invalidRows.map(row => [row.lasyncro_order_id, row]));

    for (const orderId of invalidPriorityIds) {
      const row = invalidById.get(orderId);

      /**
       * Deterministic classification priority (existing reasons unchanged):
       *   no row for this shop        -> not_in_pool         (cross-tenant / unknown)
       *   active constraint           -> blocked
       *   already holds a batch row   -> already_batched
       *   status left pending/processing -> status_changed
       *   exists + pending + unblocked + unbatched but no usable WMS line
       *                               -> no_releasable_lines   (Slice A)
       *   has usable line(s) but an unresolved intake exception
       *                               -> intake_exception      (Slice B, PART 9)
       *   otherwise                   -> not_in_pool
       */
      const reason: SkippedReleaseOrderReason = !row
        ? 'not_in_pool'
        : row.constraint_type
        ? 'blocked'
        : row.pick_batch_id
        ? 'already_batched'
        : !['pending', 'processing'].includes(row.status)
        ? 'status_changed'
        : !row.has_usable_wms_line
        ? 'no_releasable_lines'
        : !row.has_no_active_intake_exception
        ? 'intake_exception'
        : 'not_in_pool';

      skippedOrders.push({
        order_id: orderId,
        external_order_id: row?.external_order_id ?? null,
        reason,
        label: getSkippedReleaseLabel(reason, row?.constraint_type ?? null),
      });
    }
  }

  if (exclusive && validPriorityIds.length === 0) {
    console.info('[PICK_BATCH_SERVICE] Exclusive release requested with no valid selected orders', {
      shopId,
      requestedOrderCount: requestedPriorityIds.length,
      skipped_order_count: skippedOrders.length,
    });

    return {
      pick_batch_id: null,
      order_count: 0,
      total_line_items: 0,
      total_units: 0,
      skipped_orders: skippedOrders,
      newly_blocked_orders: [],
    };
  }

  if (eligibleOrders.length === 0) {
    console.info('[PICK_BATCH_SERVICE] No eligible orders found', { shopId });
    return null;
  }

  const priorityFlaggedIds = eligibleOrders
    .filter(o => o.is_priority_flagged && !validPriorityIds.includes(o.lasyncro_order_id))
    .map(o => o.lasyncro_order_id);
  const remainingIds = eligibleOrders
    .filter(o => !validPriorityIds.includes(o.lasyncro_order_id) && !priorityFlaggedIds.includes(o.lasyncro_order_id))
    .map(o => o.lasyncro_order_id);

  const candidateIds = [...validPriorityIds, ...priorityFlaggedIds, ...remainingIds];

  // 4. Greedy fill up to max_batch_line_items ceiling — full orders only
  let selectedOrderIds: string[] = [];
  let runningLineItems = 0;
  let runningUnits = 0;

  // Exclusive mode — only batch the explicitly selected orders, no greedy fill
  const idsToProcess = (exclusive && validPriorityIds.length > 0)
    ? validPriorityIds
    : candidateIds;

  for (const orderId of idsToProcess) {
    const lineItems = await trx('order_line_items')
      .where({ lasyncro_order_id: orderId })
      .select('lasyncro_line_item_id', 'quantity');
    const orderLineCount = lineItems.length;
    const orderUnitCount = lineItems.reduce((sum, li) => sum + Number(li.quantity), 0);
    if (runningLineItems + orderLineCount > maxLineItems) {
      // Starvation guard: if nothing selected yet, include oversized order anyway
      if (selectedOrderIds.length === 0) {
        selectedOrderIds.push(orderId);
        runningLineItems += orderLineCount;
        runningUnits += orderUnitCount;
      }
      break;
    }
    selectedOrderIds.push(orderId);
    runningLineItems += orderLineCount;
    runningUnits += orderUnitCount;
  }
  if (selectedOrderIds.length === 0) {
    console.info('[PICK_BATCH_SERVICE] No orders fit within ceiling', { shopId, maxLineItems });
    return null;
  }

  // Anchor selected orders, then re-run the unchanged eligibility rules.
  selectedOrderIds = [...new Set(selectedOrderIds)];
  await trx('orders')
    .where({ shop_id: shopId })
    .whereIn('lasyncro_order_id', selectedOrderIds)
    .orderBy('lasyncro_order_id', 'asc')
    .forUpdate()
    .select('lasyncro_order_id');
  const currentEligible = await eligibleOrdersQuery.clone()
    .whereIn('o.lasyncro_order_id', selectedOrderIds);
  const currentEligibleIds = new Set(currentEligible.map(row => row.lasyncro_order_id));
  selectedOrderIds = selectedOrderIds.filter(id => currentEligibleIds.has(id));
  if (selectedOrderIds.length === 0) return null;
  const selectedLines = await trx('order_line_items')
    .whereIn('lasyncro_order_id', selectedOrderIds)
    .select('quantity');
  runningLineItems = selectedLines.length;
  runningUnits = selectedLines.reduce((sum, line) => sum + Number(line.quantity), 0);

  // 4. Create pick batch
  const pickBatchId = randomUUID();

 await trx('pick_batches').insert({
    pick_batch_id: pickBatchId,
    shop_id: shopId,
    status: 'pending',
    release_trigger: trigger,
    max_line_items: maxLineItems,
    total_line_items: runningLineItems,
    total_units: runningUnits,
    released_by: releasedBy,
    released_at: new Date(),
    assigned_operator_id: assignedOperatorId ?? null,
    assigned_packer_id: assignedPackerId ?? null,
  });

  // 5. Assign orders to batch
  await trx('pick_batch_orders').insert(
    selectedOrderIds.map((orderId) => ({
      pick_batch_id: pickBatchId,
      lasyncro_order_id: orderId,
      shop_id: shopId,
    }))
  );

  /**
   * RESERVATION HOLD ON BATCH RELEASE (INV-03 / E2E-011)
   * ----------------------------------------------------
   * Aggregate repeated variant lines and reserve against the exact
   * active-bin rows used by inventoryConstraintEvaluator.
   *
   * reserveBatchInventory locks the affected inventory_truth rows,
   * splits demand deterministically across bins, writes one movement
   * per batch + variant + location, and applies each projection
   * mutation only when its movement was newly inserted.
   */
let allLineItems = await trx('order_line_items')
    .whereIn('lasyncro_order_id', selectedOrderIds)
    .select(
      'lasyncro_order_id',
      'lasyncro_line_item_id',
      'lasyncro_variant_id',
      'quantity'
    );

  /**
   * FLOW-INVENTORY-TRIGGER-GAP-01 — RELEASE-TIME AVAILABILITY CHECK
   * ---------------------------------------------------------------
   * order_constraints is only rewritten when an order receives a domain
   * event, and the inventory domain emits none (stow, receive and pick
   * write inventory_truth directly). So an order evaluated while stock
   * existed stays "ready" in the pool after the stock is gone, and
   * reserveBatchInventory — one all-or-nothing call for the whole batch —
   * threw a raw service error that killed the release for every order in
   * it, including the ones that were perfectly satisfiable.
   *
   * Here we ask the same question reserveBatchInventory will ask, one
   * order at a time, BEFORE committing to the batch. Orders that cannot
   * be satisfied are re-evaluated through the canonical evaluator +
   * projection path (no second writer, no second definition), which
   * writes the inventory constraint that was missing. That removes them
   * from the pool and surfaces them under Blocked Orders, so the merchant
   * has a real state to act on instead of an order that silently fails
   * to release on every attempt.
   *
   * Uses readReleaseCapacity — the same capacity source
   * reserveBatchInventory locks, so the two cannot disagree.
   *
   * RACE: a concurrent release could consume stock between this check and
   * the reservation below. reserveBatchInventory still takes FOR UPDATE
   * and still throws on a genuine race — rare, and failing loudly there
   * is correct. This check is for the common case: stock that was already
   * gone before anyone clicked release.
   */
  const demandByOrder = new Map<string, Map<string, number>>();
  for (const li of allLineItems) {
    const perVariant = demandByOrder.get(li.lasyncro_order_id) ?? new Map();
    perVariant.set(
      li.lasyncro_variant_id,
      (perVariant.get(li.lasyncro_variant_id) ?? 0) + Number(li.quantity)
    );
    demandByOrder.set(li.lasyncro_order_id, perVariant);
  }

  const variantIds = [
    ...new Set(allLineItems.map((li) => li.lasyncro_variant_id)),
  ];

  // GH-1145-A1: same capacity source as the evaluator and the reservation
  // lock — no second definition. Non-locking here; reserveBatchInventory
  // re-reads the same rows FOR UPDATE.
  const availableByVariant = sumReleaseCapacityByVariant(
    await readReleaseCapacity(trx, {
      shopId,
      variantIds,
      lock: 'none',
    })
  );

  /**
   * Allocate greedily in the batch's own order so a shortfall lands on
   * exactly one order rather than starving several partially. Same
   * intent as allocateRequiredQuantities' bins-first fill.
   */
  const remainingByVariant = new Map(availableByVariant);
  const unsatisfiableOrderIds: string[] = [];

  for (const orderId of selectedOrderIds) {
    const demand = demandByOrder.get(orderId);
    if (!demand) {
      throw new Error(
        `[PICK_BATCH_SERVICE] Order ${orderId} was selected for release but has no line items. Refusing to release an empty order.`
      );
    }

    const canSatisfy = [...demand.entries()].every(
      ([variantId, qty]) => (remainingByVariant.get(variantId) ?? 0) >= qty
    );

    if (canSatisfy) {
      for (const [variantId, qty] of demand.entries()) {
        remainingByVariant.set(
          variantId,
          (remainingByVariant.get(variantId) ?? 0) - qty
        );
      }
    } else {
      unsatisfiableOrderIds.push(orderId);
    }
  }

  let newlyBlockedOrders: NewlyBlockedOrder[] = [];

  /**
   * D1 — CANONICAL TRUTH BOUNDARY FOR RELEASE-DERIVED BLOCKS
   * ---------------------------------------------------------
   * The precheck above decides a loser against capacity *net of the
   * winners ahead of it*, but evaluateOrderConstraints reads live
   * inventory_truth. Run before the winners' reservation, the evaluator
   * still sees the pre-reservation stock, emits inventory isActive=false,
   * and the loser returns to the pool READY while the response says it
   * moved to Blocked.
   *
   * So this runs only once inventory_truth reflects every surviving
   * reservation: after reserveBatchInventory when winners remain, or
   * straight away when every order starved (nothing is reserved, so truth
   * is already final). An order is reported only after its canonical
   * projection has run. Any throw here aborts the caller's transaction,
   * rolling back the batch and any reservation with it.
   */
  const persistNewlyBlockedOrders = async (): Promise<NewlyBlockedOrder[]> => {
    const persisted: NewlyBlockedOrder[] = [];

    const externalIds = await trx('external_order_identity_map')
      .whereIn('lasyncro_order_id', unsatisfiableOrderIds)
      .select('lasyncro_order_id', 'external_order_id');

    const externalById = new Map(
      externalIds.map((r: { lasyncro_order_id: string; external_order_id: string }) => [
        r.lasyncro_order_id,
        r.external_order_id,
      ])
    );

    for (const orderId of unsatisfiableOrderIds) {
      /**
       * Canonical path: evaluate, then persist. projectOrderConstraints
       * owns the lifecycle (started_at, resolved_at, write_source) and
       * is the only thing that writes order_constraints.
       */
      const orderRow = await trx('orders')
        .where({ lasyncro_order_id: orderId, shop_id: shopId })
        .first('aggregate_version');

      if (!orderRow?.aggregate_version) {
        /**
         * Same invariant projection.engine.ts enforces. Throw rather than
         * skip: unlike receiveJob's bulk revalidation, this order is being
         * dropped from a batch right now. Silently failing to write its
         * constraint would leave it in the pool, falsely releasable, and
         * the merchant would be told it moved to Blocked when it did not.
         */
        throw new Error(
          `[PICK_BATCH_SERVICE] Order ${orderId} has no aggregate_version; cannot persist the inventory constraint that release just derived.`
        );
      }

      const evaluations = await evaluateOrderConstraints(trx, orderId, shopId);

      /**
       * PROJECTION WRITER BYPASS
       * ------------------------
       * order_constraints is guarded by
       * enforce_projection_writer_order_constraints. This is a legitimate
       * projection write — constraint revalidation after release found the
       * stock gone — occurring outside the projection engine's own
       * transaction. Same pattern and same justification as DF-04-FIX-01
       * in receiveJob.service.ts. SET LOCAL scopes it to this transaction.
       */
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      await projectOrderConstraints(
        trx,
        orderId,
        shopId,
        orderRow.aggregate_version,
        new Date(),
        evaluations
      );

      persisted.push({
        order_id: orderId,
        external_order_id: externalById.get(orderId) ?? null,
        block_type: 'oversell',
        label: RELEASE_CONSTRAINT_LABELS.inventory,
      });
    }

    console.info('[PICK_BATCH_RELEASE_ORDERS_NEWLY_BLOCKED]', {
      shopId,
      pickBatchId,
      newly_blocked_count: persisted.length,
      order_ids: unsatisfiableOrderIds,
    });

    return persisted;
  };

  if (unsatisfiableOrderIds.length > 0) {
    selectedOrderIds = selectedOrderIds.filter(
      (id) => !unsatisfiableOrderIds.includes(id)
    );

    allLineItems = allLineItems.filter(
      (li) => !unsatisfiableOrderIds.includes(li.lasyncro_order_id)
    );

    /**
     * Membership rows were inserted at step 5 for every selected order,
     * before this check could know any were starved. Leaving them would
     * make a newly-blocked order simultaneously blocked AND batched:
     * the pool excludes on pick_batch_orders, so the order would vanish
     * from both the pool and the batch it isn't really in, and
     * in_batch_order_count would over-report. Also required before the
     * empty-batch delete below, which the FK would otherwise reject.
     */
    await trx('pick_batch_orders')
      .where({ pick_batch_id: pickBatchId, shop_id: shopId })
      .whereIn('lasyncro_order_id', unsatisfiableOrderIds)
      .delete();

    /**
     * Batch totals were computed during greedy fill (step 4) and already
     * written to pick_batches. Dropping orders here invalidates them, so
     * recompute from the surviving line items and correct the row —
     * otherwise the batch reports units it will never contain and the
     * pick UI's progress denominator is wrong.
     */
    runningLineItems = allLineItems.length;
    runningUnits = allLineItems.reduce((sum, li) => sum + Number(li.quantity), 0);

    await trx('pick_batches')
      .where({ pick_batch_id: pickBatchId, shop_id: shopId })
      .update({
        total_line_items: runningLineItems,
        total_units: runningUnits,
        updated_at: new Date(),
      });
  }

  /**
   * EMPTY-BATCH GUARD (FLOW-INVENTORY-TRIGGER-GAP-01)
   * -------------------------------------------------
   * The pick_batches row was inserted at step 4, before the availability
   * check above could know any order was starved. If every selected order
   * turned out unsatisfiable, that row is now a batch with no orders:
   * httpGetBatches excludes only pack_complete and cancelled, so a
   * zero-order 'pending' batch would render as a claimable card in the
   * Fulfillment rail with nothing in it, and would inflate the header's
   * active-batch count (FLOW-COUNT-01).
   *
   * Deleting is safe here specifically because nothing has been reserved
   * yet — this runs before reserveBatchInventory, so there is no
   * inventory_movements ledger entry to strand and no inventory_truth
   * decrement to unwind. Do NOT copy this delete to any point after
   * reservation.
   */
  if (selectedOrderIds.length === 0) {
    // No survivor, so no reservation: truth is already final for the losers.
    newlyBlockedOrders = await persistNewlyBlockedOrders();

    console.info('[PICK_BATCH_RELEASE_ALL_ORDERS_NEWLY_BLOCKED]', {
      shopId,
      pickBatchId,
      newly_blocked_count: newlyBlockedOrders.length,
    });

    await trx('pick_batches')
      .where({ pick_batch_id: pickBatchId, shop_id: shopId })
      .delete();

    return {
      pick_batch_id: null,
      order_count: 0,
      total_line_items: 0,
      total_units: 0,
      skipped_orders: skippedOrders,
      newly_blocked_orders: newlyBlockedOrders,
    };
  }

  await reserveBatchInventory(trx, {
    shopId,
    pickBatchId,
    releasedBy,
    lineItems: allLineItems,
  });

  // D1: winners' reservation is now in inventory_truth — only now can the
  // canonical evaluator see the shortage the precheck found for the losers.
  if (unsatisfiableOrderIds.length > 0) {
    newlyBlockedOrders = await persistNewlyBlockedOrders();
  }

  console.info('[PICK_BATCH_RELEASED]', {
    pick_batch_id: pickBatchId,
    shopId,
    trigger,
    releasedBy,
    order_count: selectedOrderIds.length,
    total_line_items: runningLineItems,
    total_units: runningUnits,
  });

  // Fire alert to owner/admin inbox — visible in Overview + Alerts tab
  await fireBatchReleasedAlert(trx, {
    shopId,
    batchId: pickBatchId,
    orderCount: selectedOrderIds.length,
    lineItems: runningLineItems,
    assignedOperatorId: assignedOperatorId ?? null,
  });

  // Notify operators — targeted if assigned, broadcast to pool otherwise
  dispatchNotification({
    shopId,
    payload: {
      title: 'New batch ready to pick',
      body: `Batch ${pickBatchId.slice(0, 8).toUpperCase()} released — ${runningLineItems} line items. Claim it to start picking.`,
      data: { route: '/wms', batchId: pickBatchId },
    },

    ...(assignedOperatorId
        ? { targetUserId: assignedOperatorId }
        : { broadcastToRole: 'operator' as const }),
  }).catch((err) => console.error('[PICK_BATCH_RELEASED_PUSH_FAILED]', err.message));

  for (const orderId of selectedOrderIds) {
    await trx('orders')
      .where({ lasyncro_order_id: orderId, shop_id: shopId })
      .whereNull('wms_barcode')
      .update({ wms_barcode: generateWmsBarcode() });
  }

  console.info('[WMS_BARCODES_GENERATED]', {
    pick_batch_id: pickBatchId,
    order_count: selectedOrderIds.length,
  });

  // 7. Initialize warehouse status for all selected orders
  await trx('order_warehouse_status').insert(
    selectedOrderIds.map((orderId) => ({
      lasyncro_order_id: orderId,
      status: 'awaiting_pick',
      pick_batch_id: pickBatchId,
      status_updated_at: new Date(),
    }))
  ).onConflict(['lasyncro_order_id']).merge({
    status: 'awaiting_pick',
    pick_batch_id: pickBatchId,
    status_updated_at: new Date(),
    updated_at: new Date(),
  });

  // 8. Initialize line item warehouse status for all selected orders
  for (const orderId of selectedOrderIds) {
    const lineItems = await trx('order_line_items')
      .where({ lasyncro_order_id: orderId })
      .select('lasyncro_line_item_id', 'lasyncro_order_id');

    if (lineItems.length === 0) continue;

    await trx('order_line_item_warehouse_status').insert(
      lineItems.map((li) => ({
        lasyncro_line_item_id: li.lasyncro_line_item_id,
        lasyncro_order_id: li.lasyncro_order_id,
        shop_id: shopId,
        status: 'awaiting_pick',
        status_updated_at: new Date(),
      }))
    ).onConflict(['lasyncro_line_item_id']).merge({
      status: 'awaiting_pick',
      status_updated_at: new Date(),
      updated_at: new Date(),
    });
  }

  return {
    pick_batch_id: pickBatchId,
    order_count: selectedOrderIds.length,
    total_line_items: runningLineItems,
    total_units: runningUnits,
    skipped_orders: skippedOrders,
    newly_blocked_orders: newlyBlockedOrders,
  };
}
