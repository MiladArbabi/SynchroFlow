// apps/frontend/src/activation/useActivationSurface.ts

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import {
  deriveActivationSurfaceState,
  type ActivationSurfaceState,
  type ActivationVerdict,
  type ActivationSurfaceContext,
} from '@lasyncro/shared/activation';

const FT0_MODAL_SESSION_KEY = 'ft0-syncing-shown';

export interface ActivationSurfaceResult {
  surface: ActivationSurfaceState | null;
  isLoading: boolean;
  error: unknown;
  dismissFT0Modal: () => void;
}

export function useActivationSurface(
  context: ActivationSurfaceContext = {}
): ActivationSurfaceResult {
  const {
    data: verdict,
    isLoading,
    error,
  } = useQuery<ActivationVerdict>({
    queryKey: ['activation', 'verdict'],
    queryFn: async () => {
      const res = await axiosInstance.get('/api/v1/activation/verdict');
      return res.data;
    },
    staleTime: 5_000,
    retry: false,
  });

  const surface = useMemo(() => {
    if (!verdict) return null;

    return deriveActivationSurfaceState({
      verdict,
      context: {
        ...context,
        ux: {
          hasSeenFT0Modal:
            typeof window !== 'undefined' &&
            sessionStorage.getItem(FT0_MODAL_SESSION_KEY) === 'true',
        },
      },
    });
  }, [verdict, context]);

  return {
    surface,
    isLoading,
    error,
    dismissFT0Modal: markFT0ModalSeen,
  };
}

export function markFT0ModalSeen(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(FT0_MODAL_SESSION_KEY, 'true');
}
