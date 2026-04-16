// apps/frontend/src/pages/ft2-pages/CashFlowPage.tsx
import { CashFlowModuleFT2 } from '@lasyncro/cashflow';
import { useCashFlow } from '../finances/useCashFlow';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';

export default function CashFlowPage() {
  const { data, isLoading, isError } = useCashFlow();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  return (
    <CashFlowModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      currency={{ displayCurrency, locale, rates }}
    />
  );
}