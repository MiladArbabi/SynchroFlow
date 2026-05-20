// apps/frontend/src/pages/wms/useWmsOperators.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface WmsOperator {
  user_id: number;
  first_name: string;
  last_name: string;
  role: string;
}

export function useWmsOperators() {
  return useQuery<{ operators: WmsOperator[] }>({
    queryKey: ['operators', 'team'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/operators/team');
      return data;
    },
    staleTime: 5 * 60_000,
  });
}