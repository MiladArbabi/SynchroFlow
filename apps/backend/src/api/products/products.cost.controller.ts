// apps/backend/src/api/products/products.cost.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * PATCH /api/v1/modules/products/variants/:variantId/cost
 * -------------------------------------------------------
 * Updates unit cost for a variant (PP4-04).
 *
 * Two-phase write (CRITICAL):
 * 1. Update variants.unit_cost — affects future order ingestion
 * 2. Backfill order_revenue_units.estimated_unit_cost for existing
 *    unfulfilled orders — resolves missing_cogs alert immediately.
 *
 * WHY backfill is safe here:
 * - The revenue-units writer treats estimated_unit_cost as an
 *   immutable economic snapshot AFTER ingestion.
 * - For unfulfilled orders the cost has NOT yet been realized —
 *   updating it reflects the operator's intent, not historical mutation.
 * - Fulfilled orders are explicitly excluded to preserve margin history.
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - RLS enforced via SET LOCAL app.current_tenant
 * - unit_cost must be > 0
 */
export const httpPatchVariantCost = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { variantId } = req.params;
  if (!variantId) return res.status(400).json({ error: 'variantId is required' });

  const { unit_cost } = req.body;
  if (unit_cost == null || typeof unit_cost !== 'number' || unit_cost <= 0) {
    return res.status(400).json({ error: 'unit_cost must be a positive number' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // STEP 1 — Update variants.unit_cost (future orders)
      const updated = await trx('variants')
        .where({ lasyncro_variant_id: variantId, shop_id: shopId })
        .update({ unit_cost, updated_at: trx.fn.now() });

      if (updated === 0) {
        return null;
      }

      /**
       * STEP 2 — Backfill order_revenue_units.estimated_unit_cost
       * ----------------------------------------------------------
       * Only for unfulfilled orders — preserves historical margin
       * integrity for already-fulfilled orders.
       *
       * Joins order_fulfillment_status to exclude fulfilled orders.
       */
      // PostgreSQL UPDATE...FROM requires raw — Knex join+update doesn't
      // produce valid UPDATE...FROM syntax for multi-table updates
      const backfillResult = await trx.raw(`
        UPDATE order_revenue_units
        SET estimated_unit_cost = ?, updated_at = CURRENT_TIMESTAMP
        WHERE lasyncro_variant_id = ?
          AND lasyncro_order_id IN (
            SELECT o.lasyncro_order_id
            FROM orders o
            LEFT JOIN order_fulfillment_status ofs
              ON ofs.lasyncro_order_id = o.lasyncro_order_id
            WHERE o.shop_id = ?
              AND (ofs.status IS NULL OR ofs.status != 'fulfilled')
          )
      `, [unit_cost, variantId, shopId]);
      const backfilled = backfillResult.rowCount ?? 0;

      console.info('[VARIANT_COST_UPDATED]', {
        shopId,
        variantId,
        unit_cost,
        backfilled_revenue_units: backfilled,
      });

      return { backfilled };
    });

    if (!result) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    return res.json({
      success: true,
      backfilled_revenue_units: result.backfilled,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[VARIANT_COST_UPDATE_FAILED]', { shopId, variantId, error: message });
    return res.status(500).json({ error: `Failed to update variant cost: ${message}` });
  }
};

/**
 * GET /api/v1/modules/products/variants/costs
 * --------------------------------------------
 * Returns all variants for the shop with their current unit_cost.
 * Used by the COGS entry UI to show which variants need cost data.
 *
 * Sorted: missing cost first (null), then by title.
 */
export const httpGetVariantCosts = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const variants = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('variants as v')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where('v.shop_id', shopId)
        // Exclude non-physical products — gift cards, digital, service variants
        // have no warehouse cost and pollute the cost entry surface
        .where('p.product_type', 'physical')
        .orderByRaw('v.unit_cost IS NOT NULL, v.title ASC')
        .select(
          'v.lasyncro_variant_id',
          'v.lasyncro_product_id',
          'v.title',
          'v.sku',
          'v.image_url',
          'v.unit_cost',
          'v.updated_at',
          'p.title as product_title',
        );
    });

    return res.json({ variants });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[VARIANT_COSTS_FETCH_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to fetch variant costs: ${message}` });
  }
};

/**
 * POST /api/v1/modules/products/variants/costs/bulk
 * --------------------------------------------------
 * Bulk update unit_cost from CSV upload (PP9b-01).
 *
 * Accepts JSON body parsed from CSV by the frontend:
 * { rows: Array<{ sku: string; unit_cost: number }> }
 *
 * For each row:
 * 1. Resolve variant by SKU (shop-scoped)
 * 2. Update variants.unit_cost
 * 3. Backfill order_revenue_units.estimated_unit_cost
 *    for unfulfilled orders (same logic as single PATCH)
 *
 * Returns:
 * { updated: N, not_found: string[], errors: string[] }
 */
export const httpBulkUpdateVariantCosts = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { rows } = req.body as { rows: Array<{ sku: string; unit_cost: number }> };

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  if (rows.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 rows per upload' });
  }

  const notFound: string[] = [];
  const errors: string[] = [];
  let updated = 0;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      for (const row of rows) {
        const { sku, unit_cost } = row;

        if (!sku || typeof sku !== 'string') {
          errors.push(`Invalid SKU: ${String(sku)}`);
          continue;
        }
        if (typeof unit_cost !== 'number' || unit_cost <= 0) {
          errors.push(`Invalid unit_cost for SKU ${sku}: must be > 0`);
          continue;
        }

        // Resolve variant by SKU — shop-scoped
        const variant = await trx('variants')
          .where({ sku, shop_id: shopId })
          .select('lasyncro_variant_id')
          .first();

        if (!variant) {
          notFound.push(sku);
          continue;
        }

        // Update variants.unit_cost
        await trx('variants')
          .where({ lasyncro_variant_id: variant.lasyncro_variant_id, shop_id: shopId })
          .update({ unit_cost, updated_at: trx.fn.now() });

        // Backfill unfulfilled order_revenue_units via subquery — Knex join+update
        // doesn't produce valid PostgreSQL UPDATE...FROM syntax
        await trx.raw(`
          UPDATE order_revenue_units
          SET estimated_unit_cost = ?, updated_at = CURRENT_TIMESTAMP
          WHERE lasyncro_variant_id = ?
            AND lasyncro_order_id IN (
              SELECT o.lasyncro_order_id
              FROM orders o
              LEFT JOIN order_fulfillment_status ofs
                ON ofs.lasyncro_order_id = o.lasyncro_order_id
              WHERE o.shop_id = ?
                AND (ofs.status IS NULL OR ofs.status != 'fulfilled')
            )
        `, [unit_cost, variant.lasyncro_variant_id, shopId]);

        updated++;
      }
    });

    console.info('[BULK_VARIANT_COST_UPDATED]', { shopId, updated, not_found: notFound.length });
    return res.json({ updated, not_found: notFound, errors });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[BULK_VARIANT_COST_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Bulk update failed: ${message}` });
  }
};
