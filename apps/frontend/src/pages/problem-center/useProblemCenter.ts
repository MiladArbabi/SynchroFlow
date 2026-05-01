// apps/frontend/src/pages/problem-center/useProblemCenter.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export function useProblemCenter() {
  return useQuery({
    queryKey: ['problem-center'],
    queryFn: () =>
      axiosInstance.get('/api/v1/wms/problem-center/pick-exceptions').then((r) => r.data),
  });
}