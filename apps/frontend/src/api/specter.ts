// apps/frontend/src/api/specter.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from 'contexts/AuthContext';

// Shape of the config blob we store for a shop.
// Intentionally loose for now – we’ll tighten this once the Specter
// onboarding UI schema stabilizes.
export interface SpecterConfigShape {
  businessStage?: 'survival' | 'growth' | 'architect';
  focusAreas?: string[];
  aiAssistsEnabled?: boolean;
  [key: string]: any;
}

export interface SpecterConfigResponse {
  shopId: number | null;
  config: SpecterConfigShape | null;
}

// --- Low-level clients (pure functions, easy to unit test) ---

export async function fetchSpecterConfig(
  accessToken: string
): Promise<SpecterConfigResponse> {
  const res = await axios.get('/api/v1/specter/config', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = res.data ?? {};

  const shopId =
    typeof payload.shopId === 'number' ? payload.shopId : null;

  const config =
    payload.config && typeof payload.config === 'object'
      ? (payload.config as SpecterConfigShape)
      : null;

  return { shopId, config };
}

export async function upsertSpecterConfig(
  accessToken: string,
  config: SpecterConfigShape
): Promise<SpecterConfigResponse> {
  const res = await axios.put(
    '/api/v1/specter/config',
    { config },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const payload = res.data ?? {};

  const shopId =
    typeof payload.shopId === 'number' ? payload.shopId : null;

  const nextConfig =
    payload.config && typeof payload.config === 'object'
      ? (payload.config as SpecterConfigShape)
      : null;

  return { shopId, config: nextConfig };
}

// --- React Query hooks (what UI will actually use) ---

export const useSpecterConfig = () => {
  const { accessToken, isLoggedIn } = useAuth();

  return useQuery({
    queryKey: ['specterConfig'],
    enabled: Boolean(accessToken && isLoggedIn),
    queryFn: () => {
      if (!accessToken) {
        throw new Error('Missing access token for Specter config fetch.');
      }
      return fetchSpecterConfig(accessToken);
    },
  });
};

export const useUpsertSpecterConfig = () => {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: SpecterConfigShape) => {
      if (!accessToken) {
        return Promise.reject(
          new Error('Missing access token for Specter config upsert.')
        );
      }
      return upsertSpecterConfig(accessToken, config);
    },
    onSuccess: () => {
      // Simple cache invalidation – refetch latest config after save
      queryClient.invalidateQueries({ queryKey: ['specterConfig'] });
    },
  });
};