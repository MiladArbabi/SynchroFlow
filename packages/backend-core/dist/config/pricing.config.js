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
export const BILLING_CURRENCIES = ['GBP', 'USD', 'EUR'];
export const CURRENCY_SYMBOLS = {
    GBP: '£',
    USD: '$',
    EUR: '€',
};
// Default locale for Intl.NumberFormat — used by formatCurrencyCompact
export const CURRENCY_LOCALES = {
    GBP: 'en-GB',
    USD: 'en-US',
    EUR: 'de-DE',
};
// Display prices in minor units (pence / cents).
// Annual = monthly × 0.8 (20% discount).
//
// GBP: Core £59.66 / Growth £133.99 / Scale £289.90
// USD: Core $79    / Growth $179    / Scale $349
// EUR: Core €69.99 / Growth €154.99 / Scale €328.50
// Annual amounts are total charged per year (not monthly equivalent).
export const PEGGED_DISPLAY_PRICES = {
    starter: {
        GBP: { monthly: 0, annual: 0 },
        USD: { monthly: 0, annual: 0 },
        EUR: { monthly: 0, annual: 0 },
    },
    core: {
        GBP: { monthly: 5966, annual: 59660 },
        USD: { monthly: 7900, annual: 79000 },
        EUR: { monthly: 6999, annual: 69999 },
    },
    growth: {
        GBP: { monthly: 13399, annual: 133990 },
        USD: { monthly: 17900, annual: 171840 },
        EUR: { monthly: 15499, annual: 154900 },
    },
    scale: {
        GBP: { monthly: 28990, annual: 289900 },
        USD: { monthly: 34900, annual: 335040 },
        EUR: { monthly: 32850, annual: 328499 },
    },
};
// Stripe Price ID lookup — reads from environment variables.
// Naming convention: STRIPE_PRICE_{TIER}_{INTERVAL}_{CURRENCY}
// GBP existing vars have no currency suffix (backwards compatible).
//
// Required env vars — all use STRIPE_PRICE_{TIER}_{INTERVAL}_{CURRENCY} convention:
//   STRIPE_PRICE_{CORE|GROWTH|SCALE}_{MONTHLY|ANNUAL}_{USD|GBP|EUR}
const PRICE_ID_ENV_KEYS = {
    core: {
        GBP: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_GBP', annual: 'STRIPE_PRICE_CORE_ANNUAL_GBP' },
        USD: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_USD', annual: 'STRIPE_PRICE_CORE_ANNUAL_USD' },
        EUR: { monthly: 'STRIPE_PRICE_CORE_MONTHLY_EUR', annual: 'STRIPE_PRICE_CORE_ANNUAL_EUR' },
    },
    growth: {
        GBP: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_GBP', annual: 'STRIPE_PRICE_GROWTH_ANNUAL_GBP' },
        USD: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_USD', annual: 'STRIPE_PRICE_GROWTH_ANNUAL_USD' },
        EUR: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY_EUR', annual: 'STRIPE_PRICE_GROWTH_ANNUAL_EUR' },
    },
    scale: {
        GBP: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_GBP', annual: 'STRIPE_PRICE_SCALE_ANNUAL_GBP' },
        USD: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_USD', annual: 'STRIPE_PRICE_SCALE_ANNUAL_USD' },
        EUR: { monthly: 'STRIPE_PRICE_SCALE_MONTHLY_EUR', annual: 'STRIPE_PRICE_SCALE_ANNUAL_EUR' },
    },
};
/**
 * Returns the Stripe Price ID for a given tier, currency, and interval.
 * Throws loudly if the env var is missing — fail at checkout creation,
 * not silently with an undefined Price ID passed to Stripe.
 */
export function getStripePriceId(tier, currency, interval) {
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
export function detectBillingCurrency(acceptLanguage) {
    if (!acceptLanguage)
        return 'USD';
    const primary = acceptLanguage.split(',')[0].toLowerCase().trim();
    if (primary.startsWith('en-us') || primary.startsWith('en-ca') || primary.startsWith('en-au'))
        return 'USD';
    if (primary.startsWith('en-gb') || primary.startsWith('en-ie'))
        return 'GBP';
    const euPrefixes = [
        'de', 'fr', 'nl', 'es', 'it', 'pt', 'pl', 'sv',
        'da', 'fi', 'nb', 'cs', 'hu', 'ro', 'el', 'sk',
        'sl', 'hr', 'bg', 'et', 'lv', 'lt', 'mt',
    ];
    if (euPrefixes.some(p => primary.startsWith(p)))
        return 'EUR';
    return 'USD';
}
/**
 * Format a minor-unit price for display.
 * Returns 'Free' for zero, symbol + whole number otherwise.
 * e.g. formatDisplayPrice(7900, 'GBP') → '£79'
 */
export function formatDisplayPrice(amountMinor, currency) {
    if (amountMinor === 0)
        return 'Free';
    const symbol = CURRENCY_SYMBOLS[currency];
    return `${symbol}${(amountMinor / 100).toFixed(0)}`;
}
/**
 * Returns true if the given string is a valid BillingCurrency.
 */
export function isValidBillingCurrency(value) {
    return BILLING_CURRENCIES.includes(value);
}
