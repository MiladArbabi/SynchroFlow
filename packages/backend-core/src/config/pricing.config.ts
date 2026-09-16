// packages/backend-core/src/config/pricing.config.ts
//
// Multi-currency Pricing Config
// ------------------------------
// SINGLE SOURCE OF TRUTH for all display prices and Stripe Price IDs.
//
// Pegged pricing — one fixed amount per currency. No live FX conversion.
// Price IDs are read from env vars — never hardcoded here.
//
// Currency detected once at shop registration from Accept-Language header.
// Persisted to shop_subscriptions.billing_currency. Never changes after that.
//
// Referenced by:
//   - billing.controller.ts (Stripe checkout session Price ID routing)
//   - shopify.billing.controller.ts (RecurringApplicationCharge amount)
//   - auth.controller.ts (billing_currency assignment on registration)
//   - Frontend pricing page (display amounts + symbols)
//
// Shopify App Store path always bills in USD — Shopify's native currency.
//
// CHANGE POLICY:
//   To change prices: update display amounts here + create new Stripe Price objects.
//   Never reuse old Price IDs for new amounts — Stripe does not allow it.
//   Add new env vars for new Price IDs, keep old vars until all subs migrated.

import type { Tier } from './tiers.js';

export type BillingCurrency = 'GBP' | 'USD' | 'EUR';
export type BillingInterval = 'monthly' | 'annual';

export const BILLING_CURRENCIES: BillingCurrency[] = ['GBP', 'USD', 'EUR'];

export const CURRENCY_SYMBOLS: Record<BillingCurrency, string> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
};

// Default locale for Intl.NumberFormat — used by formatCurrencyCompact
export const CURRENCY_LOCALES: Record<BillingCurrency, string> = {
  GBP: 'en-GB',
  USD: 'en-US',
  EUR: 'de-DE',
};

// Display prices in minor units (pence / cents).
//
// New self-service purchases are USD monthly only:
// Core $99 / Growth $249 / Scale $599.
//
// Existing GBP, EUR, and annual values below remain legacy provider
// display/recognition values for subscriptions created under those price
// objects. They must not be recomputed from the new USD monthly PLG anchors.
// Annual amounts are total charged per year (not monthly equivalent).
export const PEGGED_DISPLAY_PRICES: Record<Tier, Record<BillingCurrency, {
  monthly: number;  // minor units
  annual: number;   // minor units — total annual charge
}>> = {
  starter: {
    GBP: { monthly: 0,     annual: 0      },
    USD: { monthly: 0,     annual: 0      },
    EUR: { monthly: 0,     annual: 0      },
  },
  core: {
    GBP: { monthly: 5966,  annual: 59660  },
    USD: { monthly: 9900,  annual: 79000  },
    EUR: { monthly: 6999,  annual: 69999  },
  },
  growth: {
    GBP: { monthly: 13399, annual: 133990 },
    USD: { monthly: 24900, annual: 171840 },
    EUR: { monthly: 15499, annual: 154900 },
  },
  scale: {
    GBP: { monthly: 28990, annual: 289900 },
    USD: { monthly: 59900, annual: 335040 },
    EUR: { monthly: 32850, annual: 328499 },
  },
};

// Stripe Price ID lookup — reads from environment variables.
// Naming convention: STRIPE_PRICE_{TIER}_{INTERVAL}_{CURRENCY}
// GBP existing vars have no currency suffix (backwards compatible).
//
// Required env vars — all use STRIPE_PRICE_{TIER}_{INTERVAL}_{CURRENCY} convention:
//   STRIPE_PRICE_{CORE|GROWTH|SCALE}_{MONTHLY|ANNUAL}_{USD|GBP|EUR}

/**
 * BILL-ENTITLEMENT-01 / P0-B3: exported so the INBOUND reverse resolver
 * (apps/backend/src/services/billing/providerPriceResolver.service.ts) is built
 * from the exact same table that drives outbound checkout. There must never be
 * a second, manually maintained list of Stripe commercial meanings — a reverse
 * map that can drift from the forward map is the defect this slice closes.
 */
export const PRICE_ID_ENV_KEYS: Record<Exclude<Tier, 'starter'>, Record<BillingCurrency, {
  monthly: string;
  annual: string;
}>> = {
  core: {
    GBP: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_GBP',   annual: 'STRIPE_PRICE_CORE_ANNUAL_GBP'   },
    USD: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_USD',   annual: 'STRIPE_PRICE_CORE_ANNUAL_USD'   },
    EUR: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_EUR',   annual: 'STRIPE_PRICE_CORE_ANNUAL_EUR'   },
  },
  growth: {
    GBP: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_GBP', annual: 'STRIPE_PRICE_GROWTH_ANNUAL_GBP' },
    USD: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_USD', annual: 'STRIPE_PRICE_GROWTH_ANNUAL_USD' },
    EUR: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_EUR', annual: 'STRIPE_PRICE_GROWTH_ANNUAL_EUR' },
  },
  scale: {
    GBP: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_GBP',  annual: 'STRIPE_PRICE_SCALE_ANNUAL_GBP'  },
    USD: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_USD',  annual: 'STRIPE_PRICE_SCALE_ANNUAL_USD'  },
    EUR: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_EUR',  annual: 'STRIPE_PRICE_SCALE_ANNUAL_EUR'  },
  },
};

/**
 * Returns the Stripe Price ID for a given tier, currency, and interval.
 * Throws loudly if the env var is missing — fail at checkout creation,
 * not silently with an undefined Price ID passed to Stripe.
 */
export function getStripePriceId(
  tier: Exclude<Tier, 'starter'>,
  currency: BillingCurrency,
  interval: BillingInterval,
): string {
  const envKey = PRICE_ID_ENV_KEYS[tier][currency][interval];
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`[pricing] Missing env var: ${envKey}. Add it to .env and Fly secrets.`);
  }
  return priceId;
}

/**
 * MON-REM-01B-4 — new PLG checkout ownership.
 *
 * PRICE_ID_ENV_KEYS remains the legacy provider-recognition table so existing
 * annual / GBP / EUR / historical USD subscriptions stay resolvable.
 * New self-service purchases are USD monthly only and use new immutable
 * Stripe Price objects.
 */
export const SELF_SERVE_PRICE_ID_ENV_KEYS = {
  core: 'STRIPE_PRICE_SELF_SERVE_CORE_MONTHLY_USD',
  growth: 'STRIPE_PRICE_SELF_SERVE_GROWTH_MONTHLY_USD',
  scale: 'STRIPE_PRICE_SELF_SERVE_SCALE_MONTHLY_USD',
} as const;

export function getSelfServeStripePriceId(
  tier: Exclude<Tier, 'starter'>,
): string {
  const envKey = SELF_SERVE_PRICE_ID_ENV_KEYS[tier];
  const priceId = process.env[envKey];

  if (!priceId) {
    throw new Error(
      `[pricing] Missing env var: ${envKey}. Add it to .env and Fly secrets.`
    );
  }

  return priceId;
}

// ── Extra-seat add-on pricing ─────────────────────────────────
// Scale excluded — self-service extra-seat add-ons are not offered on Scale.
// Confirmed live in Stripe (2026-07-14): 6 Price objects, one per
// tier x currency, e.g. "Core - Extra seat/month USD".

export type SeatTier = 'core' | 'growth';

// Display prices in minor units (pence / cents), monthly only —
// seat add-ons are not offered annually.
export const SEAT_DISPLAY_PRICES: Record<SeatTier, Record<BillingCurrency, number>> = {
  core:   { GBP: 1200, USD: 1500, EUR: 1300 },
  growth: { GBP: 1000, USD: 1200, EUR: 1100 },
};

/** Exported for the same single-source-of-truth reason as PRICE_ID_ENV_KEYS. */
export const SEAT_PRICE_ID_ENV_KEYS: Record<SeatTier, Record<BillingCurrency, string>> = {
  core: {
    GBP: 'STRIPE_PRICE_SEAT_ADDON_CORE_GBP',
    USD: 'STRIPE_PRICE_SEAT_ADDON_CORE_USD',
    EUR: 'STRIPE_PRICE_SEAT_ADDON_CORE_EUR',
  },
  growth: {
    GBP: 'STRIPE_PRICE_SEAT_ADDON_GROWTH_GBP',
    USD: 'STRIPE_PRICE_SEAT_ADDON_GROWTH_USD',
    EUR: 'STRIPE_PRICE_SEAT_ADDON_GROWTH_EUR',
  },
};

/**
 * Returns the Stripe Price ID for an extra-seat add-on.
 * Throws loudly if the env var is missing, same contract as getStripePriceId.
 */
export function getSeatPriceId(tier: SeatTier, currency: BillingCurrency): string {
  const envKey = SEAT_PRICE_ID_ENV_KEYS[tier][currency];
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`[pricing] Missing env var: ${envKey}. Add it to .env and Fly secrets.`);
  }
  return priceId;
}

/**
 * Detect billing currency from Accept-Language header.
 * Called once at shop registration — result persisted to shop_subscriptions.billing_currency.
 * Never called again for that shop.
 */
export function detectBillingCurrency(acceptLanguage?: string): BillingCurrency {
  if (!acceptLanguage) return 'USD';
  const primary = acceptLanguage.split(',')[0].toLowerCase().trim();

  if (primary.startsWith('en-us') || primary.startsWith('en-ca') || primary.startsWith('en-au')) return 'USD';
  if (primary.startsWith('en-gb') || primary.startsWith('en-ie')) return 'GBP';

  const euPrefixes = [
    'de', 'fr', 'nl', 'es', 'it', 'pt', 'pl', 'sv',
    'da', 'fi', 'nb', 'cs', 'hu', 'ro', 'el', 'sk',
    'sl', 'hr', 'bg', 'et', 'lv', 'lt', 'mt',
  ];
  if (euPrefixes.some(p => primary.startsWith(p))) return 'EUR';

  return 'USD';
}

/**
 * Format a minor-unit price for display.
 * Returns 'Free' for zero, symbol + whole number otherwise.
 * e.g. formatDisplayPrice(7900, 'GBP') → '£79'
 */
export function formatDisplayPrice(amountMinor: number, currency: BillingCurrency): string {
  if (amountMinor === 0) return 'Free';
  const symbol = CURRENCY_SYMBOLS[currency];
  return `${symbol}${(amountMinor / 100).toFixed(0)}`;
}

/**
 * Returns true if the given string is a valid BillingCurrency.
 */
export function isValidBillingCurrency(value: unknown): value is BillingCurrency {
  return BILLING_CURRENCIES.includes(value as BillingCurrency);
}