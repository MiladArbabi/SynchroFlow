// apps/frontend/src/pages/ft2-pages/SkuGapsPage.tsx
import { useCallback } from 'react';
import { SkuGapsModuleFT2 } from '@lasyncro/sku-gaps';
import { useSkuGaps } from '../sku-gaps/useSkuGaps';
import { axiosInstance } from 'api/axiosConfig';

export default function SkuGapsPage() {
  const { data, isLoading, isError, refetch } = useSkuGaps();

  const handleResolve = useCallback(async (exceptionId: string, note: string) => {
    await axiosInstance.post(`/api/v1/wms/sku-gaps/${exceptionId}/resolve`, {
      resolution_note: note,
    });
  }, []);

  return (
    <SkuGapsModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      onResolve={handleResolve}
      onRefresh={refetch}
    />
  );
}