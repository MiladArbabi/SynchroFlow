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
// No default_supplier_id, ever — see playbook §6a. Every call recomputes
// from real PO history + the live scorecard, same discipline as the rest
// of this codebase's explicit-data-over-inference principle.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export async function httpGetSourcingRecommendations(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { variantId } = req.params;
  const neededQty = Number(req.query.needed ?? 0);

  if (!variantId) {
    return res.status(400).json({ error: 'variantId is required' });
  }

  try {
    let candidates: any[]   = [];
    let preferences: any[]  = [];
    let productId: string | null = null;
    let productType: string | null = null;

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

    // §6a scoring + §7.8 Step 2: annotate with preference tier
    const scored = candidates.map((c: any) => {
      const onTime      = Number(c.on_time_rate ?? 0);
      const fill        = Number(c.fill_rate    ?? 0);
      const defect      = Number(c.defect_rate  ?? 0);
      const exceedsMoq  = neededQty > 0 && Number(c.moq ?? 0) > neededQty;
      const score       = onTime + fill - defect;
      const pref        = prefBySupplierId.get(c.id);

      return {
        ...c,
        score,
        exceeds_moq:        exceedsMoq,
        // §7.8 preference fields — additive, not breaking
        is_preferred:       !!pref,
        preference_tier:    pref ? 1 : 2,
        preference_priority: pref?.priority ?? null,
        preference_scope:   pref?.scope_type ?? null,
        preference_note:    pref?.note ?? null,
      };
    });

    // §7.8 Step 2 sort: preferred first (by preference_priority ASC),
    // then scorecard-ranked remainder, MOQ-exceeders always last.
    const preferred    = scored.filter(c => c.is_preferred && !c.exceeds_moq)
                               .sort((a, b) => (a.preference_priority ?? 99) - (b.preference_priority ?? 99));
    const nonPreferred = scored.filter(c => !c.is_preferred && !c.exceeds_moq)
                               .sort((a, b) => b.score - a.score);
    const exceedsMoq   = scored.filter(c => c.exceeds_moq)
                               .sort((a, b) => b.score - a.score);

    const ranked = [...preferred, ...nonPreferred, ...exceedsMoq];

    return res.json({
      variant_id:   variantId,
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
        .select('v.lasyncro_variant_id', 'v.sku', 'v.title');
    });

    return res.json({ count: result.length, variants: result });
  } catch (err) {
    console.error('[sourcing] httpGetNeverOrderedVariants failed', err);
    return res.status(500).json({ error: 'Failed to fetch never-ordered variants' });
  }
}