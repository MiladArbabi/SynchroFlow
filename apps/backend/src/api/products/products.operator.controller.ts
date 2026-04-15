// apps/backend/src/api/products/products.operator.controller.ts
import { Request, Response } from 'express';
import { getProductsOperatorSummary } from '../../services/products-operator/ProductsOperatorSummary.provider.js';
import {
  FT2DateRangePreset,
  resolveFt2PeriodFromPreset,
  getFt2Period,
} from '@lasyncro/backend-core/utils/ft2Period.js';

/**
 * GET /api/v1/modules/products/operator-summary
 * ----------------------------------------------
 * Purpose-built operator surface for Products module.
 *
 * Returns actionable operator data — sellability, dead weight,
 * catalog drift, and top returned variants.
 *
 * DESIGN CONTRACT:
 * - No FTEP constraints — direct operator surface
 * - Authenticated + shop-scoped
 * - Period-aware via FT2 date range
 * - Read-only — never mutates
 */
export async function getProductsOperatorSummaryHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const preset = req.query.preset as FT2DateRangePreset | undefined;
    const period = preset
      ? preset === 'custom'
        ? resolveFt2PeriodFromPreset({
            preset: 'custom',
            from: String(req.query.from),
            to: String(req.query.to),
          })
        : resolveFt2PeriodFromPreset({ preset })
      : getFt2Period();

    const summary = await getProductsOperatorSummary({ shopId, period });

    res.status(200).json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PRODUCTS_OPERATOR_SUMMARY_FAILED]', { error: message });
    res.status(500).json({ error: message });
  }
}