// apps/frontend/src/pages/customers/useCustomersFt2Snapshot.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export function useCustomersFt2Snapshot(
  enabled: boolean
) {
  return useQuery({
    queryKey: ['customers-ft2'],
    enabled,
    queryFn: async () => {
      const res = await axiosInstance.get('/api/v1/modules/customers/ft2');
      return res.data;
    },
  });
}