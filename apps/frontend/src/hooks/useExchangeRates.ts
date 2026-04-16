// apps/frontend/src/hooks/useExchangeRates.ts
import { useState, useEffect } from 'react';
import { fetchExchangeRates, type ExchangeRatesResponse } from 'api/currency';

/**
 * EXCHANGE RATES HOOK
 * -------------------
 * Fetches today's exchange rates once on mount.
 * Rates are cached in memory for the session — no re-fetch needed.
 *
 * Usage:
 *   const { rates } = useExchangeRates();
 *   const converted = (amount * (rates['EUR'] ?? 1));
 *
 * Note: USD is always 1.0 (base). If target === base, no conversion needed.
 */
export function useExchangeRates() {
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchExchangeRates()
      .then((data: ExchangeRatesResponse) => {
        if (cancelled) return;
        setRates({ USD: 1, ...data.rates });
        setIsStale(data.stale);
      })
      .catch(() => {
        // Silent fallback — rates stay at 1:1, amounts display in base currency
        if (!cancelled) {
          console.warn('[useExchangeRates] failed to fetch rates — displaying in base currency');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { rates, isLoading, isStale };
}