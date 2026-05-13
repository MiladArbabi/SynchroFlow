// apps/frontend/src/pages/ft2-pages/FinancesMarginPage.tsx
//
// Margin tab — per-order and per-SKU margin breakdown.
// Date range bar drives the margin trend chart window (converted to days).

import { useState } from 'react';
import { FT2DateRangeBar, type FT2DateRange } from '@lasyncro/ui-ft2';
import { useMargin } from '../finances/useMargin';
import { useSkuMargin } from '../finances/useSkuMargin';
import { useMarginTrend } from '../finances/useMarginTrend';
import { FinancesModuleFT2 } from '@lasyncro/finances';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';

/** Maps FT2 preset to days for margin trend window */
function presetToDays(range: FT2DateRange): number {
  if (range.preset === 'past_7_days' || range.preset === 'this_week' || range.preset === 'last_week') return 7;
  if (range.preset === 'this_month' || range.preset === 'last_month') return 30;
  if (range.preset === 'custom' && range.from && range.to) {
    const diff = Math.round(
      (new Date(range.to).getTime() - new Date(range.from).getTime())
      / (1000 * 60 * 60 * 24)
    );
    return Math.min(90, Math.max(7, diff));
  }
  return 30; // default: past_30_days + today
}

export default function FinancesMarginPage() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_30_days',
    from: null,
    to: null,
  });

  const days = presetToDays(range);
  const marginQuery     = useMargin();
  const skuMarginQuery  = useSkuMargin();
  const marginTrendQuery = useMarginTrend(days);
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  return (
    <>
      <FT2DateRangeBar value={range} onChange={setRange} />
      <FinancesModuleFT2
        context={{ revenueObserved: null, netObserved: null }}
        timeAwareness={null}
        timeline={null}
        blindSpots={null}
        decisionSafety={null}
        profitPreconditions={null}
        refundReality={null}
        costReality={null}
        refundImpact={null}
        financialConsistency={null}
        margin={marginQuery.data ?? null}
        skuMargin={skuMarginQuery.data ?? null}
        marginTrend={marginTrendQuery.data ?? null}
        currency={{ displayCurrency, locale, rates }}
      />
    </>
  );
}