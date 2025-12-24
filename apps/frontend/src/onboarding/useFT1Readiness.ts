//apps/frontend/src/onboarding/useFT1Readiness.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export function useFT1Readiness() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['onboarding-readiness'],
    queryFn: async () => {
      const res = await axiosInstance.get('/api/v1/onboarding/readiness');
      return res.data.ft1;
    },
    staleTime: 15_000,
  });

  return {
    ft1: data,
    isLoading,
    error,
  };
}