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
//     shipped line contributes 0 — no order-status filter needed (and `orders`
//     has no status column).
//   available = SUM(inventory_truth.available_quantity) across locations.
//     That table is written ONLY by physical events (receive/stow/pick), so a
//     missing row means genuinely zero, not unknown. Floored at 0 because
//     available_quantity goes negative on oversell.
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
import db from '@lasyncro/backend-core/db.js';
import { computeVariantPlanning } from '../../services/demand/demandIntelligence.service.js';
import type { DemandVelocity } from '../../services/demand/demandIntelligence.service.js';

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

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // §7.8 Step 0: resolve product_id + product_type for scope fallback
      const variant = await trx('variants as v')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where('v.lasyncro_variant_id', variantId)
        .andWhere('v.shop_id', shopId)
        .select('v.lasyncro_product_id as product_id', 'p.product_type')
        .first();

      productId   = variant?.product_id   ?? null;
      productType = variant?.product_type ?? null;

      // ── SRC-03: SHORTFALL RESOLVER ──────────────────────────────────────
      // Open demand = units ordered but not yet fulfilled. order_revenue_units
      // enforces fulfilled_quantity <= quantity (CHECK constraint), so a fully
      // shipped line contributes 0 — no order-status filter needed, and none
      // exists on `orders` anyway.
      const demandRow = await trx('order_revenue_units as oru')
        .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('oru.lasyncro_variant_id', variantId)
        .sum({ demand: trx.raw('oru.quantity - oru.fulfilled_quantity') })
        .first();

      // inventory_truth is written ONLY by physical events (receive, stow,
      // pick, cancel). A variant with no row has genuinely never been received,
      // so absence means zero — not "unknown". Rows are per location_code, so
      // this sums across locations. available_quantity can go negative on
      // oversell, which is why the shortfall is floored below.
      const availRow = await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .sum({ available: 'available_quantity' })
        .first();

      demandQty    = Number(demandRow?.demand ?? 0);
      availableQty = Number(availRow?.available ?? 0);
      neededQty    = Math.max(0, demandQty - availableQty);

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
    } else if (suggestedQty !== null) {
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
      // Velocity and lead time both present but no suggestion produced.
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

    return res.json({
      variant_id:   variantId,
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