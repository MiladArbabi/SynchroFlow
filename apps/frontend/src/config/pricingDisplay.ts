// apps/frontend/src/config/pricingDisplay.ts
//
// Frontend pricing display config — UI only.
// Amounts mirror Stripe actuals in pricing.config.ts (backend-core).
// No Price IDs here — those are backend-only.
//
// CHANGE POLICY: if Stripe prices change, update backend pricing.config.ts
// AND this file together.

import type { Tier } from './tiers';

export type BillingCurrency = 'USD' | 'GBP' | 'EUR';

export const CURRENCY_SYMBOLS: Record<BillingCurrency, string> = {
  USD: '$',
  GBP: '£',
  EUR: '€',
};

// Amounts in major units (dollars/pounds/euros) for display.
// Source of truth: Stripe CSV + pricing.config.ts
export const PEGGED_DISPLAY_PRICES: Record<
  Exclude<Tier, 'starter'>,
  Record<BillingCurrency, { monthly: number; annual: number }>
> = {
  core: {
    USD: { monthly: 79,     annual: 790    },
    GBP: { monthly: 59.66, annual: 596.60 },
    EUR: { monthly: 69.99, annual: 699.99 },
  },
  growth: {
    USD: { monthly: 179,    annual: 1718.40  },
    GBP: { monthly: 133.99, annual: 1339.90  },
    EUR: { monthly: 154.99, annual: 1549.00  },
  },
  scale: {
    USD: { monthly: 349,    annual: 3350.40  },
    GBP: { monthly: 289.90, annual: 2899.00  },
    EUR: { monthly: 328.50, annual: 3284.99  },
  },
};

/**
 * Format a major-unit price for display.
 * e.g. formatDisplayPrice(79, 'USD') → '$79'
 *      formatDisplayPrice(59.66, 'GBP') → '£59.66'
 */
export function formatDisplayPrice(amount: number, currency: BillingCurrency): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  return Number.isInteger(amount)
    ? `${symbol}${amount}`
    : `${symbol}${amount.toFixed(2)}`;
}

/**
 * Annual savings vs paying monthly for a full year.
 */
export function annualSavings(tier: Exclude<Tier, 'starter'>, currency: BillingCurrency): number {
  const p = PEGGED_DISPLAY_PRICES[tier][currency];
  return Math.round((p.monthly * 12 - p.annual) * 100) / 100;
}

// ── Extra-seat add-on pricing (AUD-C16) ──────────────────────
// Mirrors backend SEAT_DISPLAY_PRICES in pricing.config.ts.
// Scale excluded — unlimited seats, no add-on needed.
export type SeatTier = 'core' | 'growth';

export const SEAT_DISPLAY_PRICES: Record<SeatTier, Record<BillingCurrency, number>> = {
  core:   { USD: 15, GBP: 12, EUR: 13 },
  growth: { USD: 12, GBP: 10, EUR: 11 },
};