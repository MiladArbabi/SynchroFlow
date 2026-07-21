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
export declare function formatCurrency(amount: number | null | undefined, currency?: string, locale?: string, rates?: Record<string, number>): string;
/**
 * FORMAT CURRENCY — NO DECIMALS
 * ------------------------------
 * For large revenue figures where decimals add noise.
 * e.g. '$1,234' instead of '$1,234.00'
 */
export declare function formatCurrencyCompact(amount: number | null | undefined, currency?: string, locale?: string, rates?: Record<string, number>): string;
//# sourceMappingURL=formatCurrency.d.ts.map