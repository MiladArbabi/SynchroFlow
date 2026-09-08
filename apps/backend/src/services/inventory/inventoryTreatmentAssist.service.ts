import { Knex } from 'knex';

import { pickableLocationCondition } from './pickableLocation.js';
import {
  countSupplierOptions,
  getCommittedInboundQty,
  getDraftPoQty,
  getPendingQueueQty,
  getVariantOpenDemandQty,
} from '../purchasing/purchasingEvidence.js';

/**
 * INV-TREAT-01 — INVENTORY TREATMENT ASSIST (READ-ONLY)
 * -----------------------------------------------------
 * Turns an ACTIVE inventory/oversell blocker into fresh evidence plus a
 * deterministic ranked recommendation, for the Order Detail read surface.
 *
 * WHY THIS IS A SERVICE AND NOT MORE SQL IN orders.service.ts
 * The ranking is a product decision with five named outcomes and three
 * distinct sources of truth (order demand, canonical pickable stock,
 * purchasing workflow). Keeping it here means one place to read the rule,
 * and orders.service.ts stays a read assembler.
 *
 * INVARIANTS THIS FILE IS RESPONSIBLE FOR
 *   - it MUTATES NOTHING. No constraint is resolved, no stock moves, no PO or
 *     reorder request is created, no decision is executed, no job is enqueued.
 *     Every statement below is a SELECT.
 *   - it introduces NO second inventory blocker formula: pickable stock comes
 *     from pickableLocationCondition, the same predicate
 *     inventoryConstraintEvaluator and batchReservation use.
 *   - committed inbound is FUTURE supply. It is never added to
 *     pickableAvailableQty and never reduces shortageQty.
 *   - pending reorder intent and draft PO work are WORKFLOW. They are reported,
 *     they steer the recommendation, and they are never counted as supply.
 *   - open_sourcing is navigation only. It carries the canonical variant and
 *     the originating order and nothing else.
 */

export type InventoryTreatmentType =
  | 'wait_for_inbound'
  | 'continue_purchasing'
  | 'source_remaining'
  | 'find_supplier'
  | 'investigate_inventory';

export type InventoryTreatmentAction = {
  type: 'open_sourcing';
  variantId: string;
  orderId: string;
};

export type InventoryTreatment = {
  type: InventoryTreatmentType;
  /** rank=1 is BEST. The array is ordered ascending, so [0] is primary. */
  rank: number;
  quantity: number | null;
  reason: string;
  automationLevel: 'inform' | 'assist';
  action: InventoryTreatmentAction | null;
};

export type InventoryAssistItem = {
  variantId: string;
  identity: {
    productTitle: string | null;
    variantTitle: string | null;
    sku: string | null;
    imageUrl: string | null;
  };
  blockerEvidence: {
    orderRemainingQty: number;
    pickableAvailableQty: number;
    shortageQty: number;
  };
  purchasingEvidence: {
    variantOpenDemandQty: number;
    committedInboundQty: number;
    pendingQueueQty: number;
    draftPoQty: number;
    supplierOptionCount: number;
  };
  treatments: InventoryTreatment[];
};

export type InventoryAssist = {
  generatedAt: string;
  items: InventoryAssistItem[];
};

/**
 * The single ranked recommendation for one variant.
 *
 * Only the PRIMARY treatment is emitted. Every rule below names exactly one
 * best next step, and the cases are mutually exclusive by construction (see
 * the exhaustiveness note at the end), so emitting further entries would mean
 * inventing product advice this contract does not define. The array shape is
 * preserved — rank=1 first, ascending — so secondary treatments can be added
 * later without changing the response contract or the UI's treatments[0]
 * primary-hierarchy rule.
 */
function rankTreatments(input: {
  orderId: string;
  variantId: string;
  orderRemainingQty: number;
  pickableAvailableQty: number;
  shortageQty: number;
  variantOpenDemandQty: number;
  committedInboundQty: number;
  pendingQueueQty: number;
  draftPoQty: number;
  supplierOptionCount: number;
}): InventoryTreatment[] {
  const {
    orderId,
    variantId,
    orderRemainingQty,
    shortageQty,
    variantOpenDemandQty,
    pickableAvailableQty,
    committedInboundQty,
    pendingQueueQty,
    draftPoQty,
    supplierOptionCount,
  } = input;

  const primary = (
    treatment: Omit<InventoryTreatment, 'rank'>
  ): InventoryTreatment[] => [{ ...treatment, rank: 1 }];

  const sourcingAction: InventoryTreatmentAction = {
    type: 'open_sourcing',
    variantId,
    orderId,
  };

  /**
   * (A) STALE / CONTRADICTORY BLOCKER.
   * Fresh canonical stock already covers this order, yet the oversell is still
   * active — the blocker has not been re-evaluated. Say so plainly. This GET
   * deliberately does NOT reconcile or resolve it: read paths do not own
   * constraint lifecycle, and a read that silently healed state would hide a
   * projection problem instead of surfacing it.
   */
  if (shortageQty <= 0) {
    return primary({
      type: 'investigate_inventory',
      quantity: null,
      reason:
        `Stock now covers this order's remaining ${orderRemainingQty} ` +
        `${orderRemainingQty === 1 ? 'unit' : 'units'} ` +
        `(${pickableAvailableQty} available to pick), but the shortage blocker ` +
        `has not cleared. Recheck inventory for this item.`,
      automationLevel: 'inform',
      action: null,
    });
  }

  /**
   * Everything below reasons about the VARIANT-WIDE position, not this order
   * alone: buying decisions are made per variant, and advising a purchase that
   * ignores the other orders queued on the same variant is how a merchant ends
   * up ordering twice. The blocker evidence above stays order-specific — the
   * two are reported separately and never substituted for each other.
   */
  const variantWideShortage = Math.max(
    0,
    variantOpenDemandQty - pickableAvailableQty
  );
  const uncoveredNeed = Math.max(0, variantWideShortage - committedInboundQty);
  const workflowQty = pendingQueueQty + draftPoQty;
  const unplannedQty = Math.max(0, uncoveredNeed - workflowQty);

  /**
   * (B) COMMITTED INBOUND ALREADY COVERS THE CURRENT VARIANT-WIDE SHORTAGE.
   * The units are bought and on the way. Note that inbound has NOT been added
   * to pickableAvailableQty above — the order is still genuinely short today,
   * which is why the blocker is still active and correct.
   *
   * This is an ASSISTED step, not a dead end: the merchant is sent to the same
   * targeted Sourcing view, where the inbound for this variant is what they
   * need to look at. Navigation only — nothing is bought, received or executed.
   */
  if (uncoveredNeed <= 0) {
    return primary({
      type: 'wait_for_inbound',
      quantity: committedInboundQty,
      reason:
        `${committedInboundQty} ${committedInboundQty === 1 ? 'unit is' : 'units are'} ` +
        `already on the way, which covers the current shortage of ` +
        `${variantWideShortage} across open orders. Review incoming stock ` +
        `rather than buying again.`,
      automationLevel: 'assist',
      action: sourcingAction,
    });
  }

  /**
   * (C) PURCHASING WORK IS ALREADY UNDER WAY.
   * Queue intent and draft POs are not supply and have not reduced the
   * shortage — but they ARE the reason not to start the same purchase a second
   * time. Only when that work fully covers what inbound does not is this the
   * best next step; a partial cover falls through to (D)/(E) for the
   * genuinely unplanned remainder.
   *
   * Also ASSISTED: the queued and draft work lives in Sourcing, so the same
   * targeted route is where "continue" actually happens. Navigation only.
   */
  if (unplannedQty <= 0 && workflowQty > 0) {
    return primary({
      type: 'continue_purchasing',
      quantity: uncoveredNeed,
      reason:
        `${uncoveredNeed} ${uncoveredNeed === 1 ? 'unit is' : 'units are'} not ` +
        `covered by incoming stock, and purchasing work for this item is ` +
        `already in progress (${pendingQueueQty} queued, ${draftPoQty} in draft). ` +
        `Continue that work rather than starting it again.`,
      automationLevel: 'assist',
      action: sourcingAction,
    });
  }

  /**
   * (D) GENUINELY UNPLANNED NEED, WITH SOMEWHERE TO BUY IT.
   * quantity is what is left after stock, committed inbound AND existing
   * purchasing work — never the raw shortage, which would send the merchant to
   * re-buy units they have already ordered or queued.
   */
  if (supplierOptionCount > 0) {
    return primary({
      type: 'source_remaining',
      quantity: unplannedQty,
      reason:
        `${unplannedQty} ${unplannedQty === 1 ? 'unit is' : 'units are'} not ` +
        `covered by stock, incoming orders or purchasing already in progress. ` +
        `${supplierOptionCount} supplier ` +
        `${supplierOptionCount === 1 ? 'option is' : 'options are'} available ` +
        `for this item.`,
      automationLevel: 'assist',
      action: sourcingAction,
    });
  }

  /**
   * (E) GENUINELY UNPLANNED NEED, WITH NOWHERE TO BUY IT.
   * No supplier is invented here — the merchant is routed to Sourcing to set
   * one up. Same navigation contract as (D); the difference is honesty about
   * what is waiting there.
   */
  return primary({
    type: 'find_supplier',
    quantity: unplannedQty,
    reason:
      `${unplannedQty} ${unplannedQty === 1 ? 'unit is' : 'units are'} unplanned ` +
      `and no supplier is set up for this item yet.`,
    automationLevel: 'assist',
    action: sourcingAction,
  });

  /**
   * EXHAUSTIVENESS: (A) covers shortageQty <= 0. Past it, if workflowQty is 0
   * then unplannedQty === uncoveredNeed, and uncoveredNeed <= 0 was already
   * returned by (B) — so reaching (D)/(E) with unplannedQty <= 0 is not
   * reachable, and every path returns exactly one primary treatment.
   */
}

/**
 * Builds the assist for one order. Returns null when the order has no ACTIVE
 * inventory/oversell constraint carrying a usable target variant — a resolved
 * inventory constraint, a customer/operational blocker, or an untargeted
 * constraint all yield nothing, deliberately.
 *
 * The caller supplies the transaction so this participates in the Order
 * Detail read's existing tenant context rather than opening its own.
 */
export async function buildInventoryAssist(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string
): Promise<InventoryAssist | null> {
  const oversellConstraints = await trx('order_constraints')
    .where({
      lasyncro_order_id: lasyncroOrderId,
      constraint_type: 'inventory',
      block_type: 'oversell',
      is_active: true,
    })
    .whereNotNull('target_id')
    .select('target_id');

  const variantIds = [
    ...new Set(
      oversellConstraints
        .map((row: { target_id: string | null }) => row.target_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ].sort();

  if (variantIds.length === 0) return null;

  /**
   * THIS ORDER'S remaining demand, per variant. Deliberately not the
   * variant-wide figure: the blocker the merchant is looking at belongs to
   * this order, and presenting catalogue-wide demand as "Need" would overstate
   * what this order is actually waiting on.
   */
  const demandRows = await trx('order_revenue_units')
    .where('lasyncro_order_id', lasyncroOrderId)
    .whereIn('lasyncro_variant_id', variantIds)
    .groupBy('lasyncro_variant_id')
    .select(
      'lasyncro_variant_id',
      trx.raw('SUM(quantity - fulfilled_quantity) as remaining_quantity')
    );

  const remainingByVariant = new Map<string, number>();
  for (const row of demandRows as Array<{
    lasyncro_variant_id: string;
    remaining_quantity: string | number;
  }>) {
    remainingByVariant.set(
      row.lasyncro_variant_id,
      Number(row.remaining_quantity ?? 0)
    );
  }

  /**
   * CANONICAL PICKABLE AVAILABILITY.
   * The join applies pickableLocationCondition — active pick bins plus the
   * warehouse root — so quarantine, receive, returns, pack, ship and problem
   * zones contribute nothing. This is the SAME predicate the constraint
   * evaluator and batch reservation use; if it ever changes, all three move
   * together, which is the entire point of the shared helper.
   */
  const availabilityRows = await trx('inventory_truth as it')
    .join('warehouse_locations as wl', function () {
      this.on('wl.location_code', '=', 'it.location_code')
        .andOn('wl.shop_id', '=', trx.raw('?', [shopId]))
        .andOnVal('wl.active', true)
        .andOn(pickableLocationCondition(trx));
    })
    .where('it.shop_id', shopId)
    .whereIn('it.lasyncro_variant_id', variantIds)
    .groupBy('it.lasyncro_variant_id')
    .select(
      'it.lasyncro_variant_id',
      trx.raw('COALESCE(SUM(it.available_quantity), 0) as available_quantity')
    );

  const availableByVariant = new Map<string, number>();
  for (const row of availabilityRows as Array<{
    lasyncro_variant_id: string;
    available_quantity: string | number;
  }>) {
    availableByVariant.set(
      row.lasyncro_variant_id,
      Number(row.available_quantity ?? 0)
    );
  }

  const identityRows = await trx('variants as v')
    .leftJoin('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
    .where('v.shop_id', shopId)
    .whereIn('v.lasyncro_variant_id', variantIds)
    .select(
      'v.lasyncro_variant_id',
      'v.title as variant_title',
      'v.sku',
      'v.image_url',
      'v.lasyncro_product_id as product_id',
      'p.title as product_title',
      'p.product_type'
    );

  const identityByVariant = new Map<
    string,
    {
      variant_title: string | null;
      sku: string | null;
      image_url: string | null;
      product_id: string | null;
      product_title: string | null;
      product_type: string | null;
    }
  >();
  for (const row of identityRows as Array<{
    lasyncro_variant_id: string;
    variant_title: string | null;
    sku: string | null;
    image_url: string | null;
    product_id: string | null;
    product_title: string | null;
    product_type: string | null;
  }>) {
    identityByVariant.set(row.lasyncro_variant_id, row);
  }

  const items: InventoryAssistItem[] = [];

  for (const variantId of variantIds) {
    const identity = identityByVariant.get(variantId) ?? null;

    const orderRemainingQty = remainingByVariant.get(variantId) ?? 0;
    const pickableAvailableQty = availableByVariant.get(variantId) ?? 0;
    const shortageQty = Math.max(0, orderRemainingQty - pickableAvailableQty);

    const [
      variantOpenDemandQty,
      committedInboundQty,
      pendingQueueQty,
      draftPoQty,
      supplierOptionCount,
    ] = await Promise.all([
      getVariantOpenDemandQty(trx, shopId, variantId),
      getCommittedInboundQty(trx, shopId, variantId),
      getPendingQueueQty(trx, shopId, variantId),
      getDraftPoQty(trx, shopId, variantId),
      countSupplierOptions(
        trx,
        shopId,
        variantId,
        identity?.product_id ?? null,
        identity?.product_type ?? null
      ),
    ]);

    items.push({
      variantId,
      identity: {
        productTitle: identity?.product_title ?? null,
        variantTitle: identity?.variant_title ?? null,
        sku: identity?.sku ?? null,
        imageUrl: identity?.image_url ?? null,
      },
      blockerEvidence: {
        orderRemainingQty,
        pickableAvailableQty,
        shortageQty,
      },
      purchasingEvidence: {
        variantOpenDemandQty,
        committedInboundQty,
        pendingQueueQty,
        draftPoQty,
        supplierOptionCount,
      },
      treatments: rankTreatments({
        orderId: lasyncroOrderId,
        variantId,
        orderRemainingQty,
        pickableAvailableQty,
        shortageQty,
        variantOpenDemandQty,
        committedInboundQty,
        pendingQueueQty,
        draftPoQty,
        supplierOptionCount,
      }),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    items,
  };
}
