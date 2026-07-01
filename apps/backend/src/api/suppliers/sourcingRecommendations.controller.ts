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
    let candidates: any[] = [];

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

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

    // BRANCH A: has history. Hard-filter MOQ, then composite rank.
    // Equal weighting v1 — see playbook §6a, deferred tuning is a known gap.
    const scored = candidates.map((c: any) => {
      const onTime = Number(c.on_time_rate ?? 0);
      const fill = Number(c.fill_rate ?? 0);
      const defect = Number(c.defect_rate ?? 0);
      const exceedsMoq = neededQty > 0 && Number(c.moq ?? 0) > neededQty;
      // Equal-weighted composite: on_time + fill rewarded, defect penalized.
      const score = onTime + fill - defect;
      return { ...c, score, exceeds_moq: exceedsMoq };
    });

    // Survivors first (sorted by score desc), MOQ-exceeders last, clearly flagged.
    const ranked = [
      ...scored.filter((c) => !c.exceeds_moq).sort((a, b) => b.score - a.score),
      ...scored.filter((c) => c.exceeds_moq).sort((a, b) => b.score - a.score),
    ];

    return res.json({ variant_id: variantId, recommendations: ranked });
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
        .where('v.shop_id', shopId)
        .andWhere('v.status', 'active')
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