// apps/frontend/src/lifecycle/useOnboardingReadiness.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { OnboardingReadinessSnapshot } from '@lasyncro/shared';

export function useOnboardingReadiness(
  enabled: boolean,
  shopId?: number
) {
  return useQuery<OnboardingReadinessSnapshot>({
    queryKey: ['onboarding-readiness', shopId],
    queryFn: async () => {
      if (!shopId) {
        throw new Error('shopId is required for onboarding readiness');
      }

      const { data } = await axiosInstance.get(
        `/api/v1/onboarding/readiness?shopId=${shopId}`
      );

      console.log('[ONBOARDING_READINESS_PAYLOAD]', data);

      return data;
    },
    enabled: enabled && !!shopId,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30_000,
  });
}