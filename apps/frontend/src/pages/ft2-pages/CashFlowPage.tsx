// apps/frontend/src/pages/ft2-pages/CashFlowPage.tsx
import { CashFlowModuleFT2 } from '@lasyncro/cashflow';
import { useCashFlow } from '../finances/useCashFlow';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import UpgradePrompt from '../../components/UpgradePrompt';

export default function CashFlowPage() {
  const { data, isLoading, isError } = useCashFlow();
  const { displayCurrency, locale, tier } = useEntitlements();
  const { rates } = useExchangeRates();
  const isLocked = tier === 'starter' || tier === 'core';

 if (isLocked) return (
    <UpgradePrompt requiredTier="growth" mode="overlay" featureName="Cash Flow Intelligence">
      <CashFlowModuleFT2
        data={null}
        isLoading={false}
        isError={false}
        currency={{ displayCurrency, locale, rates }}
      />
    </UpgradePrompt>
  );

  return (
    <CashFlowModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      currency={{ displayCurrency, locale, rates }}
    />
  );
}