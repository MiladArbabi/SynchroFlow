// modules/shared/src/ui/formatCurrency.ts
/**
 * FORMAT CURRENCY (SHARED UTILITY)
 * ---------------------------------
 * All monetary display must go through this function.
 * Never hardcode '$' or any currency symbol in UI components.
 *
 * Architecture:
 * - Layer 1: base_currency stored per shop in DB (set at Shopify OAuth)
 * - Layer 2: display_currency per user in shop_memberships (user preference)
 * - Layer 3: locale-aware formatting via Intl.NumberFormat (this function)
 *
 * Conversion:
 * - All DB values are in shop base_currency (USD by default)
 * - If displayCurrency !== base_currency, convert using rates map
 * - rates map: { EUR: 0.92, GBP: 0.79, ... } (1 USD = N target)
 * - If rates are unavailable, display in base currency without conversion
 *
 * Rules:
 * - Never store converted values in DB
 * - Infinity is handled gracefully for tier cap displays
 * - null/undefined renders as '—'
 *
 * Usage:
 *   formatCurrency(1234.5, 'USD', 'en-US') → '$1,234.50'
 *   formatCurrency(1234.5, 'EUR', 'de-DE', { EUR: 0.92 }) → '1.136,94 €'
 *   formatCurrency(Infinity, 'USD', 'en-US') → '∞'
 *   formatCurrency(null, 'USD', 'en-US') → '—'
 */
export function formatCurrency(amount, currency = 'USD', locale = 'en-US', rates) {
    if (amount == null)
        return '—';
    if (!isFinite(amount))
        return '∞';
    // Convert if rates available and target differs from base (USD)
    const converted = (rates && currency !== 'USD' && rates[currency] != null)
        ? amount * rates[currency]
        : amount;
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(converted);
    }
    catch {
        return `${currency} ${converted.toFixed(2)}`;
    }
}
/**
 * FORMAT CURRENCY — NO DECIMALS
 * ------------------------------
 * For large revenue figures where decimals add noise.
 * e.g. '$1,234' instead of '$1,234.00'
 */
export function formatCurrencyCompact(amount, currency = 'USD', locale = 'en-US', rates) {
    if (amount == null)
        return '—';
    if (!isFinite(amount))
        return '∞';
    const converted = (rates && currency !== 'USD' && rates[currency] != null)
        ? amount * rates[currency]
        : amount;
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(converted);
    }
    catch {
        return `${currency} ${Math.round(converted).toLocaleString()}`;
    }
}
