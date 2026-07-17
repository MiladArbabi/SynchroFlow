// apps/backend/src/api/products/products.operator.controller.ts
import { Request, Response } from 'express';
import { getProductsOperatorSummary } from '../../services/products-operator/ProductsOperatorSummary.provider.js';
import {
  FT2DateRangePreset,
  resolveFt2PeriodFromPreset,
  getFt2Period,
} from '@lasyncro/backend-core/utils/ft2Period.js';
import { isValidTier } from '@lasyncro/backend-core/config/tiers.js';
import { tierDataWindowSince } from '@lasyncro/backend-core/utils/tierDataWindow.js';

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

    const rawTier = req.user?.tier;
    const tier = isValidTier(rawTier) ? rawTier : 'starter';
    const windowSince = tierDataWindowSince(tier);
    const clampedPeriod = windowSince && new Date(period.from) < windowSince
      ? { from: windowSince.toISOString(), to: period.to }
      : period;
    const summary = await getProductsOperatorSummary({ shopId, period: clampedPeriod });

    res.status(200).json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PRODUCTS_OPERATOR_SUMMARY_FAILED]', { error: message });
    res.status(500).json({ error: message });
  }
}