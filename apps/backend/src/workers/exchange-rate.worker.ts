// apps/backend/src/workers/exchange-rate.worker.ts

/**
 * EXCHANGE RATE WORKER
 * --------------------
 * Fetches daily exchange rates from open.er-api.com (free, no API key required).
 * Upserts into exchange_rates table once per day.
 *
 * Architecture:
 * - Base currency: USD (pivot — all rates expressed as 1 USD = N target)
 * - Runs once at startup, then every 24 hours
 * - Skips fetch if today's rates already exist in DB
 * - Never converts DB values — rates are consumed display-only by frontend
 *
 * Supported currencies must match SUPPORTED_CURRENCIES in LocalizationSettings.tsx.
 * If you add a currency there, add it here too.
 *
 * Provider: https://open.er-api.com/v6/latest/USD (free tier, ~1500 req/month)
 */

import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import axios from 'axios';

const SUPPORTED_TARGET_CURRENCIES = [
  'EUR', 'GBP', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'CHF', 'JPY'
];

const BASE_CURRENCY = 'USD';
const PROVIDER_URL = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`;
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let running = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function fetchAndUpsertRates(): Promise<void> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Skip if today's rates already exist
  const existing = await systemQuery(
    db('exchange_rates')
      .where({ base_currency: BASE_CURRENCY, valid_on: today })
      .count<{ count: string }[]>('id as count')
      .first()
  );

  if (existing && Number(existing.count) >= SUPPORTED_TARGET_CURRENCIES.length) {
    console.info('[exchange-rate-worker] rates already current, skipping fetch', { date: today });
    return;
  }

  try {
    const res = await axios.get<{ rates: Record<string, number> }>(PROVIDER_URL, {
      timeout: 10000,
    });

    const rates = res.data?.rates;
    if (!rates) throw new Error('EXCHANGE_RATE_RESPONSE_MALFORMED');

    const rows = SUPPORTED_TARGET_CURRENCIES
      .filter(currency => rates[currency] != null)
      .map(currency => ({
        base_currency: BASE_CURRENCY,
        target_currency: currency,
        rate: rates[currency],
        fetched_at: new Date(),
        valid_on: today,
      }));

    await systemQuery(
      db('exchange_rates')
        .insert(rows)
        .onConflict(['base_currency', 'target_currency', 'valid_on'])
        .merge({
          rate: db.raw('EXCLUDED.rate'),
          fetched_at: db.raw('EXCLUDED.fetched_at'),
        })
    );

    console.info('[exchange-rate-worker] rates upserted', {
      date: today,
      currencies: rows.map(r => r.target_currency),
      count: rows.length,
    });
  } catch (err) {
    console.error('[exchange-rate-worker] fetch failed', {
      error: err instanceof Error ? err.message : err,
    });
  }
}

export async function startExchangeRateWorker(): Promise<void> {
  if (running) return;
  running = true;

  console.info('[exchange-rate-worker] started');

  // Fetch immediately on boot
  await fetchAndUpsertRates();

  // Then refresh every 24 hours
  intervalHandle = setInterval(fetchAndUpsertRates, POLL_INTERVAL_MS);
}

export function stopExchangeRateWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  running = false;
  console.info('[exchange-rate-worker] stopped');
}
