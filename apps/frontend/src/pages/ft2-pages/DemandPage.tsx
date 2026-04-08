// apps/frontend/src/pages/ft2-pages/DemandPage.tsx
import { DemandModuleFT2 } from '@lasyncro/demand';
import { useDemand } from '../products/useDemand';

export default function DemandPage() {
  const { data, isLoading, isError } = useDemand();
  return <DemandModuleFT2 data={data ?? null} isLoading={isLoading} isError={isError} />;
}