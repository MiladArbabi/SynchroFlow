// apps/backend/src/api/currency/currency.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/currency/rates
 * --------------------------
 * Returns today's exchange rates for all supported currencies.
 * Rates are fetched daily by exchange-rate.worker.ts.
 * Base currency is always USD.
 *
 * Frontend uses these for display-only conversion via formatCurrency().
 * Never used for DB storage — all values remain in shop base_currency.
 */
const router = Router();

router.get('/rates', authenticateToken, async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const rates = await db('exchange_rates')
      .where({ valid_on: today })
      .select('target_currency', 'rate', 'fetched_at');

    if (rates.length === 0) {
      // Fallback to most recent available rates if today's haven't been fetched yet
      const latest = await db('exchange_rates')
        .select('target_currency', 'rate', 'fetched_at', 'valid_on')
        .whereIn(
          'id',
          db('exchange_rates')
            .select(db.raw('MAX(id) as id'))
            .groupBy('target_currency')
        );

      return res.json({
        base: 'USD',
        date: latest[0]?.valid_on ?? today,
        rates: Object.fromEntries(latest.map(r => [r.target_currency, Number(r.rate)])),
        stale: true,
      });
    }

    return res.json({
      base: 'USD',
      date: today,
      rates: Object.fromEntries(rates.map(r => [r.target_currency, Number(r.rate)])),
      stale: false,
    });
  } catch (err) {
    console.error('[currency] rates fetch failed', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;