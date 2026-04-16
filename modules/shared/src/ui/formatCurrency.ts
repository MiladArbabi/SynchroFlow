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
 * Rules:
 * - DB values are always stored in base_currency — never converted
 * - Conversion is display-only, never persisted
 * - Infinity is handled gracefully for tier cap displays
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  if (amount == null) return '—';
  if (!isFinite(amount)) return '∞';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * FORMAT CURRENCY — NO DECIMALS
 * ------------------------------
 * For large revenue figures where decimals add noise.
 * e.g. '$1,234' instead of '$1,234.00'
 */
export function formatCurrencyCompact(
  amount: number | null | undefined,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  if (amount == null) return '—';
  if (!isFinite(amount)) return '∞';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}