// apps/frontend/src/hooks/useSystemHealth.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type SystemHealthStatus = 'healthy' | 'warning' | 'critical' | 'stalled' | 'unknown';

export type SystemHealth = {
  status: SystemHealthStatus;
  timestamp: string;
  projection: Array<{
    projection_name: string;
    lag_events: number;
    lag_seconds: number | null;
    status: SystemHealthStatus;
  }>;
  snapshot: {
    last_snapshot_at: string | null;
    lag_seconds: number | null;
    status: 'fresh' | 'stale' | 'unknown';
  };
};

/**
 * useSystemHealth
 * ---------------
 * Fetches system health from /api/v1/system/health.
 *
 * Rules:
 * - Only active during FT2 (caller must gate on phase)
 * - Polls every 30s to match backend health worker cadence
 * - Silent on error — never disrupts the operator
 */
export function useSystemHealth(enabled: boolean) {
  return useQuery<SystemHealth>({
    queryKey: ['system', 'health'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/system/health');
      return data;
    },
    enabled,
    refetchInterval: 30_000,
    /**
     * Keep previous data while refetching.
     * Prevents banner flicker on background refresh.
     */
    placeholderData: (prev) => prev,
  });
}