import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from './useExchangeRates';
import { formatCurrency, formatCurrencyCompact } from '@lasyncro/shared/ui';

/**
 * USE CURRENCY (APP-LEVEL HOOK)
 * -------------------------------
 * Single entry point for all currency formatting in apps/frontend pages.
 * Wraps modules/shared's pure formatCurrency/formatCurrencyCompact with
 * useEntitlements() + useExchangeRates() so page components never need to
 * import Intl.NumberFormat, hardcode a currency code, or assemble the
 * three pieces (currency, locale, rates) themselves.
 *
 * NOTE: lives in apps/frontend, not modules/shared — modules cannot import
 * from apps/frontend (EntitlementsContext lives there), so React-context-
 * dependent code stays app-side. Modules that need currency/locale receive
 * them as explicit props from their app-level parent page (see the
 * "CURRENCY LAYER 3" comment convention in OperationalCommandCenter.tsx /
 * FinancesModuleFT2.tsx) — this hook is what supplies those props.
 *
 * TWO KINDS OF MONEY IN THIS APP — pick the right one per call site:
 *
 * 1. TRANSACTION CURRENCY — what a customer actually paid for ONE order.
 *    Single-order detail views (line items, subtotal, tax, total, receipts).
 *    Never convert this — pass the order's own currency explicitly:
 *      format(order.total, { currency: order.currency })
 *
 * 2. DISPLAY CURRENCY — the shop owner's chosen currency for dashboards,
 *    KPIs, and anything that sums or compares ACROSS multiple orders.
 *    This is the default when no currency override is given:
 *      format(heldRevenue)   // uses shop's displayCurrency automatically
 *
 * Getting this wrong either shows a customer's receipt in the wrong
 * currency (never do this) or leaves an aggregate stuck in USD forever
 * even after the shop owner changes their display currency preference
 * (the bug this hook exists to prevent — see ISS-109-119).
 *
 * Usage:
 *   const { format, formatCompact, displayCurrency } = useCurrency();
 *   format(order.total, { currency: order.currency })   // transaction
 *   formatCompact(heldRevenue)                            // aggregate
 */
export function useCurrency() {
  const { displayCurrency, locale } = useEntitlements();
  const { rates, isStale } = useExchangeRates();

  const format = (
    amount: number | null | undefined,
    opts?: { currency?: string }
  ): string =>
    formatCurrency(amount, opts?.currency ?? displayCurrency, locale, rates);

  const formatCompact = (
    amount: number | null | undefined,
    opts?: { currency?: string }
  ): string =>
    formatCurrencyCompact(amount, opts?.currency ?? displayCurrency, locale, rates);

  return { format, formatCompact, displayCurrency, locale, ratesAreStale: isStale };
}
