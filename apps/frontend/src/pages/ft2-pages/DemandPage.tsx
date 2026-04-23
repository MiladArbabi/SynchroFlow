// apps/frontend/src/pages/ft2-pages/DemandPage.tsx
import { DemandModuleFT2 } from '@lasyncro/demand';
import { useDemand } from '../products/useDemand';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import UpgradePrompt from '../../components/UpgradePrompt';

export default function DemandPage() {
  const { data, isLoading, isError } = useDemand();
  const { displayCurrency, locale, tier } = useEntitlements();
  const { rates } = useExchangeRates();
  const isLocked = tier === 'starter' || tier === 'core';

  if (isLocked) return (
    <UpgradePrompt requiredTier="growth" mode="overlay" featureName="Demand Forecasting">
      <DemandModuleFT2
        data={null}
        isLoading={false}
        isError={false}
        currency={{ displayCurrency, locale, rates }}
      />
    </UpgradePrompt>
  );

  return (
    <DemandModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      currency={{ displayCurrency, locale, rates }}
    />
  );
}