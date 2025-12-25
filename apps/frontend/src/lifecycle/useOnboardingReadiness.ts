// apps/frontend/src/lifecycle/useOnboardingReadiness.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

interface OnboardingReadinessResponse {
  ready: boolean;
}

export function useOnboardingReadiness(
  enabled: boolean,
  shopId?: number
) {
  return useQuery<OnboardingReadinessResponse>({
    queryKey: ['onboarding-readiness', shopId],
    queryFn: async () => {
      if (!shopId) {
        throw new Error('shopId is required for onboarding readiness');
      }

      const { data } = await axiosInstance.get(
        `/api/v1/onboarding/readiness?shopId=${shopId}`
      );

      return data;
    },
    enabled: enabled && !!shopId,
    refetchOnWindowFocus: true,
    retry: false,
  });
}