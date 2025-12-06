// apps/frontend/src/hooks/useOnboardingReadiness.ts
import { useCallback, useEffect, useState } from 'react';
import type { OnboardingReadinessSnapshot } from '@lasyncro/shared';
import { fetchOnboardingReadiness } from 'api/onboarding';

type UseOnboardingReadinessOptions = {
  shopId?: number;
  accessToken?: string;
};

type UseOnboardingReadinessState = {
  data?: OnboardingReadinessSnapshot;
  loading: boolean;
  error?: Error;
};

export function useOnboardingReadiness(
  opts?: UseOnboardingReadinessOptions
) {
  const [state, setState] = useState<UseOnboardingReadinessState>({
    loading: true,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    try {
      const data = await fetchOnboardingReadiness({
        shopId: opts?.shopId,
        accessToken: opts?.accessToken,
      });

      setState({
        data,
        loading: false,
        error: undefined,
      });
    } catch (err) {
      setState({
        data: undefined,
        loading: false,
        error: err as Error,
      });
    }
  }, [opts?.shopId, opts?.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    refetch: load,
  };
}