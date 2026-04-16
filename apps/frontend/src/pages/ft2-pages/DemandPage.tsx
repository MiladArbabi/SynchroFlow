// apps/frontend/src/pages/ft2-pages/DemandPage.tsx
import { DemandModuleFT2 } from '@lasyncro/demand';
import { useDemand } from '../products/useDemand';
import { useEntitlements } from 'contexts/EntitlementsContext';

export default function DemandPage() {
  const { data, isLoading, isError } = useDemand();
  const { displayCurrency, locale } = useEntitlements();

  return (
    <DemandModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      currency={{ displayCurrency, locale }}
    />
  );
}