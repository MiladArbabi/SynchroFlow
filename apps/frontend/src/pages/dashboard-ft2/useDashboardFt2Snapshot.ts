import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export function useDashboardFt2Snapshot() {
  return useQuery({
    queryKey: ['dashboard', 'ft2'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/dashboard/ft2');
      return data;
    },
  });
}