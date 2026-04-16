// apps/frontend/src/pages/ft2-pages/CashFlowPage.tsx
import { CashFlowModuleFT2 } from '@lasyncro/cashflow';
import { useCashFlow } from '../finances/useCashFlow';
import { useEntitlements } from 'contexts/EntitlementsContext';

export default function CashFlowPage() {
  const { data, isLoading, isError } = useCashFlow();
  const { displayCurrency, locale } = useEntitlements();

  return (
    <CashFlowModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      currency={{ displayCurrency, locale }}
    />
  );
}