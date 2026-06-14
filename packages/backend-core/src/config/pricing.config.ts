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
// Annual = monthly × 0.8 (20% discount).
//
// GBP: Core £79 / Growth £179 / Scale £349
// USD: Core $99 / Growth $219 / Scale $429
// EUR: Core €89 / Growth €199 / Scale €389
export const PEGGED_DISPLAY_PRICES: Record<Tier, Record<BillingCurrency, {
  monthly: number;  // minor units
  annual: number;   // minor units (monthly × 0.8, per month equivalent)
}>> = {
  starter: {
    GBP: { monthly: 0,     annual: 0     },
    USD: { monthly: 0,     annual: 0     },
    EUR: { monthly: 0,     annual: 0     },
  },
  core: {
    GBP: { monthly: 7900,  annual: 6320  },
    USD: { monthly: 9900,  annual: 7920  },
    EUR: { monthly: 8900,  annual: 7120  },
  },
  growth: {
    GBP: { monthly: 17900, annual: 14320 },
    USD: { monthly: 21900, annual: 17520 },
    EUR: { monthly: 19900, annual: 15920 },
  },
  scale: {
    GBP: { monthly: 34900, annual: 27920 },
    USD: { monthly: 42900, annual: 34320 },
    EUR: { monthly: 38900, annual: 31120 },
  },
};

// Stripe Price ID lookup — reads from environment variables.
// Naming convention: STRIPE_PRICE_{TIER}_{INTERVAL}_{CURRENCY}
// GBP existing vars have no currency suffix (backwards compatible).
//
// Required env vars:
//   GBP (existing):
//     STRIPE_PRICE_CORE_MONTHLY, STRIPE_PRICE_CORE_ANNUAL
//     STRIPE_PRICE_GROWTH_MONTHLY, STRIPE_PRICE_GROWTH_ANNUAL
//     STRIPE_PRICE_SCALE_MONTHLY, STRIPE_PRICE_SCALE_ANNUAL
//   USD (new):
//     STRIPE_PRICE_CORE_MONTHLY_USD, STRIPE_PRICE_CORE_ANNUAL_USD
//     STRIPE_PRICE_GROWTH_MONTHLY_USD, STRIPE_PRICE_GROWTH_ANNUAL_USD
//     STRIPE_PRICE_SCALE_MONTHLY_USD, STRIPE_PRICE_SCALE_ANNUAL_USD
//   EUR (new):
//     STRIPE_PRICE_CORE_MONTHLY_EUR, STRIPE_PRICE_CORE_ANNUAL_EUR
//     STRIPE_PRICE_GROWTH_MONTHLY_EUR, STRIPE_PRICE_GROWTH_ANNUAL_EUR
//     STRIPE_PRICE_SCALE_MONTHLY_EUR, STRIPE_PRICE_SCALE_ANNUAL_EUR

const PRICE_ID_ENV_KEYS: Record<Exclude<Tier, 'starter'>, Record<BillingCurrency, {
  monthly: string;
  annual: string;
}>> = {
  core: {
    GBP: { monthly: 'STRIPE_PRICE_CORE_MONTHLY',        annual: 'STRIPE_PRICE_CORE_ANNUAL'        },
    USD: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_USD',    annual: 'STRIPE_PRICE_CORE_ANNUAL_USD'    },
    EUR: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_EUR',    annual: 'STRIPE_PRICE_CORE_ANNUAL_EUR'    },
  },
  growth: {
    GBP: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY',      annual: 'STRIPE_PRICE_GROWTH_ANNUAL'      },
    USD: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_USD',  annual: 'STRIPE_PRICE_GROWTH_ANNUAL_USD'  },
    EUR: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_EUR',  annual: 'STRIPE_PRICE_GROWTH_ANNUAL_EUR'  },
  },
  scale: {
    GBP: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY',       annual: 'STRIPE_PRICE_SCALE_ANNUAL'       },
    USD: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_USD',   annual: 'STRIPE_PRICE_SCALE_ANNUAL_USD'   },
    EUR: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_EUR',   annual: 'STRIPE_PRICE_SCALE_ANNUAL_EUR'   },
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
 * Detect billing currency from Accept-Language header.
 * Called once at shop registration — result persisted to shop_subscriptions.billing_currency.
 * Never called again for that shop.
 */
export function detectBillingCurrency(acceptLanguage?: string): BillingCurrency {
  if (!acceptLanguage) return 'GBP';
  const primary = acceptLanguage.split(',')[0].toLowerCase().trim();

  if (primary.startsWith('en-us') || primary.startsWith('en-ca') || primary.startsWith('en-au')) return 'USD';
  if (primary.startsWith('en-gb') || primary.startsWith('en-ie')) return 'GBP';

  const euPrefixes = [
    'de', 'fr', 'nl', 'es', 'it', 'pt', 'pl', 'sv',
    'da', 'fi', 'nb', 'cs', 'hu', 'ro', 'el', 'sk',
    'sl', 'hr', 'bg', 'et', 'lv', 'lt', 'mt',
  ];
  if (euPrefixes.some(p => primary.startsWith(p))) return 'EUR';

  return 'GBP';
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