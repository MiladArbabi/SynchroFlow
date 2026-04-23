// apps/frontend/src/pages/ft2-pages/FinancesFT2Page.tsx
import { useState } from 'react';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import { FT2DateRangeBar } from '@lasyncro/ui-ft2';
import { FinancesModuleFT2 } from '@lasyncro/finances';
import { useFinancesFt2Snapshot } from '../finances/useFinancesFt2Snapshot';
import { mapFinancesFt2Props } from '../finances/useFinancesFt2Adapter';
import { useMargin } from '../finances/useMargin';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import UpgradePrompt from '../../components/UpgradePrompt';

const __DEV__ = import.meta.env.DEV;

export default function FinancesFT2Page() {
  const [range, setRange] = useState<FT2DateRange>({
    preset: 'past_30_days',
    from: null,
    to: null,
  });

  const snapshotQuery = useFinancesFt2Snapshot(range);
  const marginQuery = useMargin();
  const { displayCurrency, locale, tier } = useEntitlements();
  const isLocked = tier === 'starter' || tier === 'core';
  const { rates } = useExchangeRates();

  if (!snapshotQuery.isSuccess) {
    if (__DEV__) console.debug('[FinancesFT2Page] awaiting FT2 snapshot');
    return <div>Loading finance insights…</div>;
  }

  const props = mapFinancesFt2Props(snapshotQuery.data);

  if (__DEV__) console.debug('[FinancesFT2Page] rendering FinancesModuleFT2', props);

  if (isLocked) return (
    <UpgradePrompt requiredTier="growth" mode="overlay" featureName="Finances Intelligence">
      <FinancesModuleFT2
        {...props}
        margin={null}
        currency={{ displayCurrency, locale, rates }}
      />
    </UpgradePrompt>
  );
  return (
    <>
      <FT2DateRangeBar value={range} onChange={setRange} />
      <FinancesModuleFT2
        {...props}
        margin={marginQuery.data ?? null}
        currency={{ displayCurrency, locale, rates }}
      />
    </>
  );
}