// apps/frontend/src/pages/ft2-pages/ProblemCenterPage.tsx
import { useCallback } from 'react';
import { ProblemCenterModuleFT2 } from '@lasyncro/problem-center';
import { useProblemCenter } from '../problem-center/useProblemCenter';
import { axiosInstance } from 'api/axiosConfig';

export default function ProblemCenterPage() {
  const { data, isLoading, isError, refetch } = useProblemCenter();
  const handleResolve = useCallback(async (exceptionId: string, note: string) => {
    await axiosInstance.post(`/api/v1/wms/problem-center/pick-exceptions/${exceptionId}/resolve`, {
      resolution_note: note,
    });
  }, []);
  return (
    <ProblemCenterModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      onResolve={handleResolve}
      onRefresh={refetch}
    />
  );
}