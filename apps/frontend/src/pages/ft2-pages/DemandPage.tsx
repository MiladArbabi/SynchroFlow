// apps/frontend/src/pages/ft2-pages/DemandPage.tsx
import { DemandModuleFT2 } from '@lasyncro/demand';
import { useDemand } from '../products/useDemand';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';

export default function DemandPage() {
  const { data, isLoading, isError } = useDemand();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  return (
    <DemandModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      currency={{ displayCurrency, locale, rates }}
    />
  );
}