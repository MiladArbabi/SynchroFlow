import type { Tier } from './tiers.js';
export type BillingCurrency = 'GBP' | 'USD' | 'EUR';
export type BillingInterval = 'monthly' | 'annual';
export declare const BILLING_CURRENCIES: BillingCurrency[];
export declare const CURRENCY_SYMBOLS: Record<BillingCurrency, string>;
export declare const CURRENCY_LOCALES: Record<BillingCurrency, string>;
export declare const PEGGED_DISPLAY_PRICES: Record<Tier, Record<BillingCurrency, {
    monthly: number;
    annual: number;
}>>;
/**
 * Returns the Stripe Price ID for a given tier, currency, and interval.
 * Throws loudly if the env var is missing — fail at checkout creation,
 * not silently with an undefined Price ID passed to Stripe.
 */
export declare function getStripePriceId(tier: Exclude<Tier, 'starter'>, currency: BillingCurrency, interval: BillingInterval): string;
/**
 * Detect billing currency from Accept-Language header.
 * Called once at shop registration — result persisted to shop_subscriptions.billing_currency.
 * Never called again for that shop.
 */
export declare function detectBillingCurrency(acceptLanguage?: string): BillingCurrency;
/**
 * Format a minor-unit price for display.
 * Returns 'Free' for zero, symbol + whole number otherwise.
 * e.g. formatDisplayPrice(7900, 'GBP') → '£79'
 */
export declare function formatDisplayPrice(amountMinor: number, currency: BillingCurrency): string;
/**
 * Returns true if the given string is a valid BillingCurrency.
 */
export declare function isValidBillingCurrency(value: unknown): value is BillingCurrency;
