// apps/frontend/src/pages/ft2-pages/WmsPage.tsx
import { WmsModuleFT2 } from '@lasyncro/wms';
import { useWms } from '../wms/useWms';

export default function WmsPage() {
  const { data, isLoading, isError } = useWms();

  return (
    <WmsModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
    />
  );
}