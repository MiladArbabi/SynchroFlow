import { pendingDeliveryQuantitySql } from '../../services/purchasing/purchasingEvidence.js';
// apps/backend/src/api/suppliers/sourcingRecommendations.controller.ts
//
// SOURCING RECOMMENDATIONS (Thread C, sourcing-recommendation-playbook.md §6)
// -----------------------------------------------------------------------------
// Two endpoints:
// - GET /sourcing-recommendations/:variantId — ranked suppliers for ONE
//   variant (Branch A) or empty array if never-ordered (Branch B).
// - GET /sourcing-recommendations/never-ordered — the live-derived list
//   of variants with zero PO history at all, for the page's group view.
//
// SRC-03 — DERIVED SHORTFALL
// The per-variant endpoint also returns `shortfall` and `shortfall_basis`:
//   shortfall = max(0, open_demand - available)
//   open_demand = SUM(quantity - fulfilled_quantity) across the variant's
//     order lines. order_revenue_units enforces fulfilled <= quantity, so a
//     shipped line contributes 0. Known fulfilled/cancelled orders are excluded;
//     missing fulfillment-status rows retain legacy demand.
//   available = canonical release capacity at active pick bins and warehouse
//     roots. Exception/staging/inactive locations cannot satisfy a shortage.
// This replaced a `?needed=` query param that no caller ever set, which meant
// every queued reorder defaulted to 1 unit and `exceeds_moq` (since removed —
// see SRC-06) could never fire.
//
// SRC-06 — MOQ GAP, NOT A VERDICT
// `exceeds_moq` compared a supplier's minimum against ONE variant's shortfall
// and never consulted reorder_requests, so a supplier already at 485 of a 500
// minimum was still flagged as exceeding it for a 15-unit variant that would
// have completed the order. The UI then rendered such suppliers dimmed, in
// red, with no queue button — steering the merchant toward an under-minimum PO
// from exactly the supplier they should have been pooling toward.
// Replaced by two quantities:
//   pooled_qty   = SUM(qty_requested) of pending reorder_requests for that
//                  supplier, across ALL variants
//   units_to_moq = max(0, moq - (pooled_qty + shortfall)); 0 means queueing
//                  this variant reaches the minimum, or there is no minimum
// MOQ no longer affects ranking. A minimum is a commercial term, not a quality
// signal, and has no business outranking an explicit merchant preference or a
// supplier's on-time record. The under-minimum PO path stays available and is
// gated downstream by SRC-01a with a confirm and an override note on the PO.
//
// No default_supplier_id, ever — see playbook §6a. Every call recomputes
// from real PO history + the live scorecard, same discipline as the rest
// of this codebase's explicit-data-over-inference principle.

import { Request, Response } from 'express';
import { readReleaseCapacity, sumReleaseCapacityByVariant } from '../../services/inventory/releaseCapacity.service.js';
import db from '@lasyncro/backend-core/db.js';
import { computeVariantPlanning } from '../../services/demand/demandIntelligence.service.js';
import type { DemandVelocity } from '../../services/demand/demandIntelligence.service.js';
import {
  COMMITTED_INBOUND_PO_STATUSES,
  getCommittedInboundQty,
  getDraftPoQty,
  getPendingQueueQty,
  getVariantOpenDemandQty,
} from '../../services/purchasing/purchasingEvidence.js';

/**
 * SRC-L3-07 — COMMITTED INBOUND STATUS DOMAIN, and the purchasing aggregates
 * built on it, now live in services/purchasing/purchasingEvidence.ts so this
 * endpoint and the Order Detail inventory assist (INV-TREAT-01) share ONE
 * definition of what is already coming and what is already being bought.
 * The SQL moved unchanged; the contracts SRC-L3-07/08/09 and SRC-ACT-BE-01/02
 * protect still mean exactly what they meant before the extraction.
 */

/** SRC-L3-02: what the merchant is actually looking at. */
type TargetedIdentity = {
  image_url: string | null;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
};

export async function httpGetSourcingRecommendations(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { variantId } = req.params;

  if (!variantId) {
    return res.status(400).json({ error: 'variantId is required' });
  }

  try {
    let candidates: any[]   = [];
    let preferences: any[]  = [];
    let productId: string | null = null;
    let productType: string | null = null;
    // SRC-03: shortfall is DERIVED, never supplied by the caller. The old
    // `?needed=` query param had no writer anywhere in the codebase, so every
    // queued reorder request defaulted to 1 unit — making the MOQ accumulator
    // unusable (a 100-unit minimum needed 100 clicks).
    let neededQty = 0;
    // SRC-12: preventive planning row for this variant (null when the
    // variant has no inventory_truth row and so cannot be planned).
    // Assigned inside the transaction closure below. TS control-flow
    // analysis cannot see that assignment from here and would narrow this
    // to its initialiser type, so the annotation is restated on the value.
    let planning: DemandVelocity | null = null as DemandVelocity | null;
    let demandQty = 0;
    let availableQty = 0;
    const pooledBySupplier = new Map<number, number>();
    // SRC-L3-02/07/10/15 — Slice 1A targeted additions. Assigned inside the
    // transaction closure below; TS control-flow analysis cannot see those
    // assignments from here, so the annotations are restated on the values.
    let identity: TargetedIdentity | null = null as TargetedIdentity | null;
    let notFound = false;
    let committedInbound = 0;
    /**
     * SLICE 1B — PURCHASING WORKFLOW FACTS
     * ------------------------------------
     * What the merchant has ALREADY started buying, as opposed to what is
     * already coming. Queue intent and draft PO work are workflow state: they
     * are the reason to stop offering to start the same purchase twice. They
     * are deliberately NOT supply — neither may enter committed_inbound, and
     * neither may reduce still_to_source. A draft nobody has sent moves no
     * stock, and a queued line is not even a draft yet.
     */
    let pendingQueueQty = 0;
    let draftPoQty = 0;
    let blockingOrders: Array<{
      order_id: string;
      external_order_id: string | null;
      units: number;
    }> = [];

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // §7.8 Step 0: resolve product_id + product_type for scope fallback.
      // SRC-L3-02: the same tenant-scoped row now also yields the identity
      // block — the page could previously never name what it was sourcing.
      const variant = await trx('variants as v')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where('v.lasyncro_variant_id', variantId)
        .andWhere('v.shop_id', shopId)
        .select(
          'v.lasyncro_product_id as product_id',
          'p.product_type',
          'v.image_url',
          'v.title as variant_title',
          'v.sku',
          'p.title as product_title'
        )
        .first();

      /**
       * SRC-L3-15: an unknown or non-tenant variant is NOT the same thing as a
       * real variant with no supplier history. Both used to return 200 with an
       * empty recommendation list, so a broken deep link was indistinguishable
       * from a product nobody has ordered yet. A missing target is now
       * explicitly 404; a valid variant with zero candidates remains a valid
       * targeted 200. Answered after the transaction closes so the early
       * return does not abort it mid-flight.
       */
      if (!variant) {
        notFound = true;
        return;
      }

      productId   = variant.product_id   ?? null;
      productType = variant.product_type ?? null;

      identity = {
        image_url:     variant.image_url     ?? null,
        product_title: variant.product_title ?? null,
        variant_title: variant.variant_title ?? null,
        sku:           variant.sku           ?? null,
      };

      // ── SRC-03: SHORTFALL RESOLVER ──────────────────────────────────────
      // Shared live-order demand preserves missing-status compatibility.
      const variantIdForEvidence = Array.isArray(variantId) ? variantId[0] : variantId;
      const openDemandQty = await getVariantOpenDemandQty(
        trx,
        shopId,
        variantIdForEvidence
      );

      const capacity = await readReleaseCapacity(trx, {
        shopId,
        variantIds: [variantIdForEvidence],
        lock: 'none',
      });

      demandQty    = openDemandQty;
      availableQty = sumReleaseCapacityByVariant(capacity).get(variantIdForEvidence) ?? 0;
      neededQty    = Math.max(0, demandQty - availableQty);

      /**
       * SRC-L3-07/08/09 — COMMITTED INBOUND
       * -----------------------------------
       * Without this the merchant sees "8 short" on a variant with 7 units
       * already on the way and re-orders stock they have already paid for.
       *
       * Aggregated in its own query, never joined onto demand or inventory: a
       * variant with 3 open POs and 2 inventory rows would otherwise multiply
       * through a many-to-many join and inflate both sides.
       *
       * Remaining is clamped at zero so an over-receipt (received > ordered)
       * cannot subtract phantom units from the requirement.
       *
       * reorder_requests are NOT consulted: a queued request is buying intent
       * pooled for MOQ, with no supplier commitment and no ETA.
       */
      committedInbound = await getCommittedInboundQty(
        trx,
        shopId,
        variantIdForEvidence
      );

      /**
       * SRC-ACT-BE-01 — PENDING QUEUE INTENT.
       * Scoped to shop AND canonical variant explicitly. RLS already isolates
       * the tenant; the shop predicate is stated anyway so the query's grain is
       * legible at the call site rather than inferred from session state.
       */
      pendingQueueQty = await getPendingQueueQty(
        trx,
        shopId,
        variantIdForEvidence
      );

      /**
       * SRC-ACT-BE-02 — DRAFT PURCHASING WORK.
       * The same GREATEST clamp as committed inbound, for the same reason: an
       * over-receipt must not subtract phantom units. Draft is the one PO
       * status that is prepared work rather than supply, which is exactly why
       * it is excluded from COMMITTED_INBOUND_PO_STATUSES and counted here.
       */
      draftPoQty = await getDraftPoQty(trx, shopId, variantIdForEvidence);

      /**
       * SRC-L3-10/11B — BLOCKING ORDER CONTEXT
       * --------------------------------------
       * Derived server-side from canonical order/variant state, never from the
       * query string. This is both the "who is waiting" context and the
       * allow-list that validates an incoming originating orderId.
       */
      blockingOrders = (
        await trx('order_revenue_units as oru')
          .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
          .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
          .where(function () {
            this.whereNull('ofs.status').orWhereNotIn('ofs.status', ['fulfilled', 'cancelled']);
          })
          .leftJoin(
            'external_order_identity_map as eim',
            'eim.lasyncro_order_id',
            'o.lasyncro_order_id'
          )
          .where('o.shop_id', shopId)
          .andWhere('oru.lasyncro_variant_id', variantId)
          .groupBy('o.lasyncro_order_id', 'eim.external_order_id')
          .havingRaw('SUM(oru.quantity - oru.fulfilled_quantity) > 0')
          .select(
            'o.lasyncro_order_id as order_id',
            'eim.external_order_id',
            trx.raw('SUM(oru.quantity - oru.fulfilled_quantity)::integer as units')
          )
      ).map((r: { order_id: string; external_order_id: string | null; units: number }) => ({
        order_id:          r.order_id,
        external_order_id: r.external_order_id ?? null,
        units:             Number(r.units),
      }));

      // ── SRC-06: POOLED QUANTITY PER SUPPLIER ────────────────────────────
      // The accumulator exists so small per-variant requirements can pool
      // across variants until a supplier's minimum becomes reachable. Judging
      // a supplier on whether THIS variant alone clears their MOQ ignores
      // everything already queued for them — a supplier sitting at 485 of a
      // 500 minimum was flagged as exceeding it for a 15-unit variant that
      // would have completed the order.
      // Knex infers the row shape from .sum() alone and drops the grouped
      // column, so the select is annotated explicitly rather than cast.
      const pooledRows = await trx('reorder_requests')
        .where({ shop_id: shopId, status: 'pending' })
        .groupBy('supplier_id')
        .select<Array<{ supplier_id: number; pooled: string | number | null }>>(
          'supplier_id',
          trx.raw('SUM(qty_requested) AS pooled')
        );

      for (const row of pooledRows) {
        pooledBySupplier.set(Number(row.supplier_id), Number(row.pooled ?? 0));
      }

      // ── SRC-12: TRUSTED PREVENTIVE REORDER POINT ────────────────────────
      // The shortfall above is REACTIVE: it fires once customers have already
      // ordered more than we hold — which is the fire, not a warning. The
      // demand engine's suggestion is preventive: velocity x (lead time +
      // safety + purchasing cycle), net of stock and committed inbound.
      // Same function the Demand module uses; no second copy of the formula.
      // Deliberately NOT wrapped in try/catch — a broken planning path must
      // surface as a 500 via the outer handler rather than silently degrade
      // to the weaker number forever.
      // req.params types variantId as string | string[]; the guard above
      // rejects empty but not the array form, so narrow explicitly rather
      // than casting and hoping.
      const variantIdStr = Array.isArray(variantId) ? variantId[0] : variantId;
      const planningRows = await computeVariantPlanning(trx, shopId, [variantIdStr]);
      planning = planningRows[0] ?? null;

      // §7.8 Step 1: resolve preference — most specific scope wins.
      // variant > product > product_type (specificity order per playbook §7.3)
      const prefRows = await trx('supplier_product_preferences')
        .where('shop_id', shopId)
        .where(function () {
          this.where({ scope_type: 'variant',      scope_id: variantId })
            .orWhere({ scope_type: 'product',      scope_id: productId ?? '' })
            .orWhere({ scope_type: 'product_type', scope_id: productType ?? '' });
        })
        .orderByRaw(`
          CASE scope_type
            WHEN 'variant'       THEN 1
            WHEN 'product'       THEN 2
            WHEN 'product_type'  THEN 3
          END ASC,
          priority ASC
        `)
        .select('supplier_id', 'scope_type', 'priority', 'note');

      preferences = prefRows;

      // §6a Branch A: suppliers with PO history for this variant
      // §6a Branch A: suppliers with PO history for this variant
      candidates = await trx('purchase_order_line_items as poli')
        .join('purchase_orders as po', 'po.id', 'poli.po_id')
        .join('suppliers as s', 's.id', 'po.supplier_id')
        .where('poli.lasyncro_variant_id', variantId)
        .andWhere('po.shop_id', shopId)
        .andWhere('s.active', true)
        .groupBy('s.id')
        .select(
          's.id', 's.name', 's.contact_name', 's.contact_email',
          's.on_time_rate', 's.fill_rate', 's.defect_rate',
          's.avg_delivery_days', 's.moq', 's.lead_time_days'
        );

      // §7.8 Tier 1 injection: a preferred supplier with no PO history for this
      // variant won't appear in candidates above — PO history is empty so the join
      // returns nothing, leaving has_preference:true but recommendations:[].
      // Fix: fetch any preferred supplier missing from candidates directly from the
      // suppliers table. Tenant safety is guaranteed — missingPreferredIds come from
      // supplier_product_preferences already scoped to shopId above.
      const candidateIds = new Set(candidates.map((c: any) => c.id));
      const missingPreferredIds = preferences
        .map((p: any) => p.supplier_id)
        .filter((id: number) => !candidateIds.has(id));

      if (missingPreferredIds.length > 0) {
        const injected = await trx('suppliers as s')
          .whereIn('s.id', missingPreferredIds)
          .andWhere('s.active', true)
          .select(
            's.id', 's.name', 's.contact_name', 's.contact_email',
            's.on_time_rate', 's.fill_rate', 's.defect_rate',
            's.avg_delivery_days', 's.moq', 's.lead_time_days'
          );
        candidates = [...candidates, ...injected];
      }
    });

    // SRC-L3-15: the target does not exist for this tenant. Answered after the
    // transaction closes so the early return does not abort it mid-flight.
    if (notFound) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    // §7.8 Step 2: build preference lookup — keyed by supplier_id.
    // Most specific scope already sorted first by the ORDER BY above.
    const prefBySupplierId = new Map<number, { scope_type: string; priority: number; note: string | null }>();
    for (const p of preferences) {
      if (!prefBySupplierId.has(p.supplier_id)) {
        // First match wins (most specific scope, lowest priority number)
        prefBySupplierId.set(p.supplier_id, { scope_type: p.scope_type, priority: p.priority, note: p.note });
      }
    }

    // ── SRC-12: WHICH QUANTITY DRIVES THE QUEUE ─────────────────────────
    // Never queue less than customers are already waiting for: when open
    // demand exceeds the forecast, the shortfall is the floor. The basis is
    // always named so the operator sees WHICH number they are acting on
    // rather than a silent substitution.
    const suggestedQty = planning?.suggested_reorder_qty ?? null;
    let queueQty: number;
    let quantityBasis: string;

    if (planning === null) {
      queueQty = neededQty;
      quantityBasis = 'reactive';
    } else if (suggestedQty !== null && suggestedQty > 0) {
      queueQty = Math.max(suggestedQty, neededQty);
      quantityBasis = 'preventive';
    } else if (planning.demand_confidence === 'none') {
      // Order matters: a variant with no sales history also has no PO history,
      // so it has no supplier lead time either. Testing lead time first made
      // this branch unreachable for exactly the variants it describes —
      // genuine absence of demand is not a data-entry gap.
      queueQty = neededQty;
      quantityBasis = neededQty > 0 ? 'reactive_no_history' : 'no_signal';
    } else if (planning.supplier_lead_time_days === null) {
      queueQty = neededQty;
      quantityBasis = neededQty > 0 ? 'reactive_no_lead_time' : 'planning_data_required';
    } else {
      // Velocity and lead time both present but no actionable suggestion.
      // SRC-18b: this now also catches suggested_reorder_qty === 0, which the
      // preventive branch previously swallowed — 0 !== null is true, so the
      // operator saw a zero labelled 'preventive', a basis asserting a
      // forecast was made on a number that means "do not order". A zero
      // suggestion means coverage is already met by stock plus committed
      // inbound; it is not a recommendation and must not be presented as one.
      queueQty = neededQty;
      quantityBasis = neededQty > 0 ? 'reactive' : 'no_signal';
    }

    // §6a scoring + §7.8 Step 2: annotate with preference tier
    const scored = candidates.map((c: any) => {
      const onTime      = Number(c.on_time_rate ?? 0);
      const fill        = Number(c.fill_rate    ?? 0);
      const defect      = Number(c.defect_rate  ?? 0);
      // SRC-06: report the GAP, not a verdict. "445 more units to reach their
      // minimum" is actionable; "exceeds MOQ" reads as a rejection and told
      // the merchant to go away from the exact supplier they should queue to.
      const pooledQty   = pooledBySupplier.get(c.id) ?? 0;
      const moqValue    = c.moq != null ? Number(c.moq) : null;
      const unitsToMoq  = moqValue === null
        ? 0
        // SRC-12: measured against queueQty, not the reactive shortfall —
        // otherwise MOQ progress describes a quantity nobody will queue.
        : Math.max(0, moqValue - (pooledQty + queueQty));
      const score       = onTime + fill - defect;
      const pref        = prefBySupplierId.get(c.id);

      return {
        ...c,
        score,
        // Units already queued for this supplier across ALL variants.
        pooled_qty:         pooledQty,
        // Still needed to reach their minimum if this variant is queued too.
        // 0 means queueing this completes it (or they have no minimum).
        units_to_moq:       unitsToMoq,
        // §7.8 preference fields — additive, not breaking
        is_preferred:       !!pref,
        preference_tier:    pref ? 1 : 2,
        preference_priority: pref?.priority ?? null,
        preference_scope:   pref?.scope_type ?? null,
        preference_note:    pref?.note ?? null,
      };
    });

    // §7.8 Step 2 sort: preferred first (by preference_priority ASC), then
    // scorecard-ranked remainder.
    // SRC-06: MOQ no longer demotes. A minimum is a commercial term, not a
    // quality signal — it has no business outranking a merchant's explicit
    // preference or a supplier's on-time record. The gap is shown per row
    // instead, and the under-minimum PO path is already gated downstream
    // (SRC-01a) with a confirm and an override note on the PO.
    const preferred    = scored.filter(c => c.is_preferred)
                               .sort((a, b) => (a.preference_priority ?? 99) - (b.preference_priority ?? 99));
    const nonPreferred = scored.filter(c => !c.is_preferred)
                               .sort((a, b) => b.score - a.score);

    const ranked = [...preferred, ...nonPreferred];

    /**
     * SRC-L3-11/11B — ORIGINATING ORDER IS CONTEXT, NOT A KEY
     * -------------------------------------------------------
     * Echoed back only when the supplied id is genuinely one of this variant's
     * canonical blocking orders. An unrelated same-tenant id resolves to null,
     * so the parameter cannot be used to have the server confirm arbitrary
     * order ids — a read widening dressed up as UX context. Read here, AFTER
     * every derived number is already fixed: it never affects the arithmetic.
     */
    const requestedOrderId =
      typeof req.query.orderId === 'string' ? req.query.orderId : null;

    const originatingOrderId =
      requestedOrderId && blockingOrders.some(o => o.order_id === requestedOrderId)
        ? requestedOrderId
        : null;

    return res.json({
      variant_id:   variantId,

      // ── SLICE 1A: TARGETED IDENTITY ──────────────────────────────────
      // What the merchant is actually looking at. Purely additive.
      image_url:     identity?.image_url     ?? null,
      product_title: identity?.product_title ?? null,
      variant_title: identity?.variant_title ?? null,
      sku:           identity?.sku           ?? null,

      // ── SLICE 1A: PURCHASING TRUTH ───────────────────────────────────
      // short_now       — the gap ignoring anything already bought
      // still_to_source — what actually remains to buy
      // Both clamped at zero; kept distinct so a merchant with stock inbound
      // is not told to re-order it.
      open_demand:       demandQty,
      available:         availableQty,
      committed_inbound: committedInbound,
      short_now:         Math.max(0, demandQty - availableQty),
      still_to_source:   Math.max(0, demandQty - availableQty - committedInbound),

      blocking_orders:      blockingOrders,
      originating_order_id: originatingOrderId,

      // ── SLICE 1B: PURCHASING WORKFLOW ────────────────────────────────
      // in_purchasing — how much of the gap the merchant has already acted on
      // unplanned     — how much still needs a purchasing decision
      // Neither touches the supply numbers above.
      pending_queue_qty: pendingQueueQty,
      draft_po_qty:      draftPoQty,
      in_purchasing:     pendingQueueQty + draftPoQty,
      unplanned: Math.max(
        0,
        Math.max(0, demandQty - availableQty - committedInbound) -
          (pendingQueueQty + draftPoQty)
      ),

      // SRC-03: derived shortfall + its basis. The UI prefills the queue
      // quantity from this and shows the basis, so the operator can see WHY
      // the number is what it is and override it when they know better
      // (promo coming, supplier case pack, etc).
      shortfall:       neededQty,
      shortfall_basis: { demand: demandQty, available: availableQty },
      // SRC-12: the preventive number and the one the UI should prefill.
      suggested_reorder_qty: suggestedQty,
      queue_qty:             queueQty,
      quantity_basis:        quantityBasis,
      planning_context: planning ? {
        demand_confidence:       planning.demand_confidence,
        velocity_window_days:    planning.velocity_window_days,
        days_of_stock_remaining: planning.days_of_stock_remaining,
        reorder_urgency:         planning.reorder_urgency,
        supplier_lead_time_days: planning.supplier_lead_time_days,
        target_coverage_days:    planning.target_coverage_days,
      } : null,
      recommendations: ranked,
      // Surface whether any preference was resolved — useful for UI badge
      has_preference: prefBySupplierId.size > 0,
    });
  } catch (err) {
    console.error('[sourcing] httpGetSourcingRecommendations failed', err);
    return res.status(500).json({ error: 'Failed to fetch sourcing recommendations' });
  }
}

export async function httpGetNeverOrderedVariants(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    let result: any[] = [];

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Live-derived, not stored — same technique as customerLtv.service.ts's
      // first_order_at. A variant with zero matching PO line item rows has
      // never been ordered. See playbook §6a.
      result = await trx('variants as v')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where('v.shop_id', shopId)
        .andWhere('v.status', 'active')
        // ISS-088/DEC-06: gift cards aren't stockable/purchasable inventory —
        // exclude from sourcing/never-ordered entirely, not just display-side.
        .andWhereNot('p.product_type', 'gift_card')
        .whereNotExists(
          trx('purchase_order_line_items as poli')
            .whereRaw('poli.lasyncro_variant_id = v.lasyncro_variant_id')
        )
        .select(
            'v.lasyncro_variant_id',
            'v.sku',
            'v.title',
            'p.title as product_title',
            'p.lasyncro_product_id as product_id',
            'p.product_type'
          );
    });

    // ISS-SR-07: annotate has_sku so UI can surface data quality nudge
    // without hiding sku-less variants (Decision B — merchant must fix in Shopify)
    const annotated = result.map((v: any) => ({
      ...v,
      has_sku: v.sku !== null && v.sku !== '',
    }));
    return res.json({ count: annotated.length, variants: annotated });
  } catch (err) {
    console.error('[sourcing] httpGetNeverOrderedVariants failed', err);
    return res.status(500).json({ error: 'Failed to fetch never-ordered variants' });
  }
}

/**
 * UNIFIED SOURCING WORKLIST (SOURCING-UX-COGNITIVE-01 Slice 2)
 * ==============================================================
 * GET /sourcing-worklist — the portfolio-wide, set-wise replacement for the
 * generic (no-variantId) Sourcing view. Distinct from, and does not replace,
 * httpGetSourcingRecommendations above (the per-variant targeted endpoint).
 *
 * SET-WISE BY CONSTRUCTION: every fact below (open demand, availability,
 * committed inbound, draft/queue workflow, supplier history/usability,
 * preferences, the canonical Demand planning signal) is computed with ONE
 * grouped query per fact across the WHOLE catalogue, then joined in memory by
 * lasyncro_variant_id. There is no per-variant loop calling into the targeted
 * resolver — that pattern is exactly what this endpoint exists to replace.
 *
 * CATEGORY PRECEDENCE (ratified, do not reorder):
 *   unplanned > 0            -> needs_supplier | needs_purchase (by usable supplier)
 *   else in_purchasing > 0   -> in_purchasing
 *   else short_now>0 && still_to_source==0 && committed_inbound>0
 *                             -> covered_inbound
 *   else canonical Demand planning signal fires
 *                             -> needs_supplier | plan_ahead (by usable supplier)
 *   else                     -> excluded from the worklist entirely
 *
 * "usable supplier" mirrors httpGetSourcingRecommendations §6a Branch A: any
 * ACTIVE supplier with purchase_order_line_items history for the variant,
 * independent of supplier_product_preferences. "supplier history" is broader
 * (any PO line at all, active supplier or not) — the two are exposed
 * separately as has_usable_supplier / has_supplier_history so a variant can
 * be in_purchasing (via a bare reorder_request) with zero PO history at all.
 *
 * Categories are a DERIVED read-model state, never persisted.
 */

const WORKLIST_CATEGORIES = [
  'needs_supplier',
  'needs_purchase',
  'in_purchasing',
  'covered_inbound',
  'plan_ahead',
] as const;
type WorklistCategory = typeof WORKLIST_CATEGORIES[number];

type WorklistItem = {
  lasyncro_variant_id: string;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  image_url: string | null;
  category: WorklistCategory;
  open_demand: number;
  blocked_order_count: number;
  oldest_open_order_at: string | null;
  available: number;
  committed_inbound: number;
  short_now: number;
  still_to_source: number;
  pending_queue_qty: number;
  draft_po_qty: number;
  in_purchasing: number;
  unplanned: number;
  has_usable_supplier: boolean;
  has_preference: boolean;
  has_supplier_history: boolean;
  planning_urgency: string | null;
  days_of_stock_remaining: number | null;
  suggested_reorder_qty: number | null;
};

const URGENCY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
  planning_data_required: 3,
  no_velocity: 4,
};

function worklistSearchMatches(item: WorklistItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (item.product_title ?? '').toLowerCase().includes(needle) ||
    (item.variant_title ?? '').toLowerCase().includes(needle) ||
    (item.sku ?? '').toLowerCase().includes(needle)
  );
}

function worklistFacetsMatch(
  item: WorklistItem,
  facets: { supplierReadiness?: string; purchasingStage?: string; coverage?: string }
): boolean {
  if (facets.supplierReadiness === 'ready' && !item.has_usable_supplier) return false;
  if (facets.supplierReadiness === 'needs_supplier' && item.category !== 'needs_supplier') return false;
  if (facets.supplierReadiness === 'no_history' && item.has_supplier_history) return false;

  if (facets.purchasingStage === 'not_started' &&
      !(item.pending_queue_qty === 0 && item.draft_po_qty === 0 && item.committed_inbound === 0)) return false;
  if (facets.purchasingStage === 'queued' && !(item.pending_queue_qty > 0)) return false;
  if (facets.purchasingStage === 'draft' && !(item.draft_po_qty > 0)) return false;
  if (facets.purchasingStage === 'committed' && !(item.committed_inbound > 0)) return false;

  if (facets.coverage === 'short' && !(item.still_to_source > 0)) return false;
  if (facets.coverage === 'covered_inbound' &&
      !(item.short_now > 0 && item.still_to_source === 0 && item.committed_inbound > 0)) return false;

  return true;
}

function worklistSort(items: WorklistItem[], sort: string): WorklistItem[] {
  const byIdAsc = (a: WorklistItem, b: WorklistItem) =>
    a.lasyncro_variant_id < b.lasyncro_variant_id ? -1 : a.lasyncro_variant_id > b.lasyncro_variant_id ? 1 : 0;

  const oldestFirst = (a: WorklistItem, b: WorklistItem) => {
    if (a.oldest_open_order_at === b.oldest_open_order_at) return byIdAsc(a, b);
    if (a.oldest_open_order_at === null) return 1;
    if (b.oldest_open_order_at === null) return -1;
    return a.oldest_open_order_at < b.oldest_open_order_at ? -1 : 1;
  };

  const largestStillToSourceFirst = (a: WorklistItem, b: WorklistItem) => {
    if (a.still_to_source === b.still_to_source) return byIdAsc(a, b);
    return b.still_to_source - a.still_to_source;
  };

  const soonestStockoutFirst = (a: WorklistItem, b: WorklistItem) => {
    if (a.days_of_stock_remaining === b.days_of_stock_remaining) return byIdAsc(a, b);
    if (a.days_of_stock_remaining === null) return 1;
    if (b.days_of_stock_remaining === null) return -1;
    return a.days_of_stock_remaining - b.days_of_stock_remaining;
  };

  const productAz = (a: WorklistItem, b: WorklistItem) => {
    const at = (a.product_title ?? '').toLowerCase();
    const bt = (b.product_title ?? '').toLowerCase();
    if (at === bt) return byIdAsc(a, b);
    return at < bt ? -1 : 1;
  };

  switch (sort) {
    case 'oldest_demand':
      return [...items].sort(oldestFirst);
    case 'still_to_source':
      return [...items].sort(largestStillToSourceFirst);
    case 'stockout_soonest':
      return [...items].sort(soonestStockoutFirst);
    case 'product_az':
      return [...items].sort(productAz);
    case 'action_priority':
    default: {
      const reactive: WorklistCategory[] = ['needs_supplier', 'needs_purchase', 'in_purchasing', 'covered_inbound'];
      return [...items].sort((a, b) => {
        const rankA = WORKLIST_CATEGORIES.indexOf(a.category);
        const rankB = WORKLIST_CATEGORIES.indexOf(b.category);
        if (rankA !== rankB) return rankA - rankB;
        if (reactive.includes(a.category)) return oldestFirst(a, b) || largestStillToSourceFirst(a, b);
        // preventive (plan_ahead): urgency rank, then soonest stockout.
        const uA = URGENCY_RANK[a.planning_urgency ?? ''] ?? 99;
        const uB = URGENCY_RANK[b.planning_urgency ?? ''] ?? 99;
        if (uA !== uB) return uA - uB;
        return soonestStockoutFirst(a, b);
      });
    }
  }
}

export async function httpGetSourcingWorklist(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const categoryParam = typeof req.query.category === 'string' ? req.query.category : undefined;
  const supplierReadiness = typeof req.query.supplier_readiness === 'string' ? req.query.supplier_readiness : undefined;
  const purchasingStage = typeof req.query.purchasing_stage === 'string' ? req.query.purchasing_stage : undefined;
  const coverage = typeof req.query.coverage === 'string' ? req.query.coverage : undefined;
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'action_priority';
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.page_size ?? '50'), 10) || 50));

  try {
    const items: WorklistItem[] = [];

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // ── CATALOGUE (set-wise, one query for the whole shop) ──────────────
      const variantRows = await trx('variants as v')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where('v.shop_id', shopId)
        .andWhere('v.status', 'active')
        .andWhereNot('p.product_type', 'gift_card')
        .select(
          'v.lasyncro_variant_id',
          'v.sku',
          'v.title as variant_title',
          'v.image_url',
          'v.lasyncro_product_id',
          'p.title as product_title',
          'p.product_type'
        );

      // ── OPEN DEMAND per variant (only lines with outstanding quantity) ──
      const demandRows = await trx('order_revenue_units as oru')
        .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
        .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
        .where(function () {
          this.whereNull('ofs.status').orWhereNotIn('ofs.status', ['fulfilled', 'cancelled']);
        })
        .where('o.shop_id', shopId)
        .whereRaw('oru.quantity > oru.fulfilled_quantity')
        .groupBy('oru.lasyncro_variant_id')
        .select(
          'oru.lasyncro_variant_id',
          trx.raw('SUM(oru.quantity - oru.fulfilled_quantity)::integer as open_demand'),
          trx.raw('COUNT(DISTINCT oru.lasyncro_order_id)::integer as blocked_order_count'),
          trx.raw('MIN(o.order_created_at) as oldest_open_order_at')
        );

      // One canonical capacity read for the catalogue; never one query per item.
      const capacity = await readReleaseCapacity(trx, {
        shopId,
        variantIds: variantRows.map((v) => v.lasyncro_variant_id),
        lock: 'none',
      });

      // ── COMMITTED INBOUND — same status domain as the targeted endpoint ──
      const committedRows = await trx('purchase_order_line_items as poli')
        .join('purchase_orders as po', 'po.id', 'poli.po_id')
        .where('po.shop_id', shopId)
        .whereIn('po.status', COMMITTED_INBOUND_PO_STATUSES as unknown as string[])
        .groupBy('poli.lasyncro_variant_id')
        .select(
          'poli.lasyncro_variant_id',
          trx.raw(`SUM(${pendingDeliveryQuantitySql()})::integer as committed_inbound`)
        );

      // ── DRAFT PO workflow qty ────────────────────────────────────────────
      const draftRows = await trx('purchase_order_line_items as poli')
        .join('purchase_orders as po', 'po.id', 'poli.po_id')
        .where('po.shop_id', shopId)
        .andWhere('po.status', 'draft')
        .groupBy('poli.lasyncro_variant_id')
        .select(
          'poli.lasyncro_variant_id',
          trx.raw('SUM(GREATEST(poli.quantity_ordered - poli.quantity_received, 0))::integer as draft_po_qty')
        );

      // ── PENDING QUEUE workflow qty ───────────────────────────────────────
      const queueRows = await trx('reorder_requests')
        .where({ shop_id: shopId, status: 'pending' })
        .groupBy('lasyncro_variant_id')
        .select('lasyncro_variant_id', trx.raw('SUM(qty_requested)::integer as pending_queue_qty'));

      // ── SUPPLIER HISTORY / USABILITY (§6a Branch A) ──────────────────────
      const historyRows = await trx('purchase_order_line_items as poli')
        .join('purchase_orders as po', 'po.id', 'poli.po_id')
        .where('po.shop_id', shopId)
        .groupBy('poli.lasyncro_variant_id')
        .select('poli.lasyncro_variant_id');

      const usableRows = await trx('purchase_order_line_items as poli')
        .join('purchase_orders as po', 'po.id', 'poli.po_id')
        .join('suppliers as s', 's.id', 'po.supplier_id')
        .where('po.shop_id', shopId)
        .andWhere('s.active', true)
        .groupBy('poli.lasyncro_variant_id')
        .select('poli.lasyncro_variant_id');

      // ── PREFERENCES (set-wise; no saved preference required for usability) ──
      const prefRows = await trx('supplier_product_preferences')
        .where({ shop_id: shopId })
        .select('scope_type', 'scope_id');

      // ── CANONICAL DEMAND PLANNING SIGNAL — ONE call, whole catalogue ─────
      const planningRows = await computeVariantPlanning(trx, shopId);

      // ── build lookup maps (all set-wise; zero per-variant queries) ───────
      const demandMap = new Map(demandRows.map((r: any) => [r.lasyncro_variant_id, r]));
      const availMap = sumReleaseCapacityByVariant(capacity);
      const committedMap = new Map(committedRows.map((r: any) => [r.lasyncro_variant_id, Number(r.committed_inbound)]));
      const draftMap = new Map(draftRows.map((r: any) => [r.lasyncro_variant_id, Number(r.draft_po_qty)]));
      const queueMap = new Map(queueRows.map((r: any) => [r.lasyncro_variant_id, Number(r.pending_queue_qty)]));
      const historySet = new Set(historyRows.map((r: any) => r.lasyncro_variant_id));
      const usableSet = new Set(usableRows.map((r: any) => r.lasyncro_variant_id));
      const planningMap = new Map(planningRows.map((r) => [r.lasyncro_variant_id, r]));

      const prefVariantSet = new Set<string>();
      const prefProductSet = new Set<string>();
      const prefTypeSet = new Set<string>();
      for (const p of prefRows as Array<{ scope_type: string; scope_id: string }>) {
        if (p.scope_type === 'variant') prefVariantSet.add(p.scope_id);
        else if (p.scope_type === 'product') prefProductSet.add(p.scope_id);
        else if (p.scope_type === 'product_type') prefTypeSet.add(p.scope_id);
      }

      // ── combine at canonical VARIANT grain — one pass, no fan-out ────────
      for (const v of variantRows as any[]) {
        const vid = v.lasyncro_variant_id;
        const demand = demandMap.get(vid);
        const open_demand = demand ? Number(demand.open_demand) : 0;
        const available = availMap.get(vid) ?? 0;
        const committed_inbound = committedMap.get(vid) ?? 0;
        const draft_po_qty = draftMap.get(vid) ?? 0;
        const pending_queue_qty = queueMap.get(vid) ?? 0;
        const in_purchasing = pending_queue_qty + draft_po_qty;
        const short_now = Math.max(0, open_demand - available);
        const still_to_source = Math.max(0, open_demand - available - committed_inbound);
        const unplanned = Math.max(0, still_to_source - in_purchasing);
        const has_supplier_history = historySet.has(vid);
        const has_usable_supplier = usableSet.has(vid);
        const has_preference =
          prefVariantSet.has(vid) ||
          prefProductSet.has(v.lasyncro_product_id) ||
          (v.product_type ? prefTypeSet.has(v.product_type) : false);
        const planning = planningMap.get(vid);
        const reorderSignal = planning?.reorder_signal ?? false;

        let category: WorklistCategory | null = null;
        if (unplanned > 0) {
          category = has_usable_supplier ? 'needs_purchase' : 'needs_supplier';
        } else if (in_purchasing > 0) {
          category = 'in_purchasing';
        } else if (short_now > 0 && still_to_source === 0 && committed_inbound > 0) {
          category = 'covered_inbound';
        } else if (reorderSignal) {
          category = has_usable_supplier ? 'plan_ahead' : 'needs_supplier';
        }
        if (!category) continue;

        items.push({
          lasyncro_variant_id: vid,
          product_title: v.product_title ?? null,
          variant_title: v.variant_title ?? null,
          sku: v.sku ?? null,
          image_url: v.image_url ?? null,
          category,
          open_demand,
          blocked_order_count: demand ? Number(demand.blocked_order_count) : 0,
          oldest_open_order_at: demand?.oldest_open_order_at
            ? new Date(demand.oldest_open_order_at).toISOString()
            : null,
          available,
          committed_inbound,
          short_now,
          still_to_source,
          pending_queue_qty,
          draft_po_qty,
          in_purchasing,
          unplanned,
          has_usable_supplier,
          has_preference,
          has_supplier_history,
          planning_urgency: planning?.reorder_urgency ?? null,
          days_of_stock_remaining: planning?.days_of_stock_remaining ?? null,
          suggested_reorder_qty: planning?.suggested_reorder_qty ?? null,
        });
      }
    });

    // ── search + facet filters define the "applicable filtered universe" ──
    // that summary counts and total are drawn from. `category` is exempt —
    // summary must show every category's count regardless of which one (if
    // any) is currently selected.
    const searched = items.filter((i) => worklistSearchMatches(i, q));
    const faceted = searched.filter((i) =>
      worklistFacetsMatch(i, { supplierReadiness, purchasingStage, coverage })
    );

    const summary = {
      needs_supplier: faceted.filter((i) => i.category === 'needs_supplier').length,
      needs_purchase: faceted.filter((i) => i.category === 'needs_purchase').length,
      in_purchasing: faceted.filter((i) => i.category === 'in_purchasing').length,
      covered_inbound: faceted.filter((i) => i.category === 'covered_inbound').length,
      plan_ahead: faceted.filter((i) => i.category === 'plan_ahead').length,
    };

    // ── category selection: default view excludes covered_inbound ───────
    let categoryFiltered: WorklistItem[];
    if (categoryParam === 'all') {
      categoryFiltered = faceted;
    } else if (categoryParam && (WORKLIST_CATEGORIES as readonly string[]).includes(categoryParam)) {
      categoryFiltered = faceted.filter((i) => i.category === categoryParam);
    } else {
      categoryFiltered = faceted.filter((i) => i.category !== 'covered_inbound');
    }

    const sorted = worklistSort(categoryFiltered, sort);

    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageItems = sorted.slice(start, start + pageSize);

    return res.json({ summary, items: pageItems, page, page_size: pageSize, total });
  } catch (err) {
    console.error('[sourcing] httpGetSourcingWorklist failed', err);
    return res.status(500).json({ error: 'Failed to fetch sourcing worklist' });
  }
}