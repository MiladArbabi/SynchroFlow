// apps/frontend/src/pages/overview/useMorningBriefSnapshot.ts
//
// Morning Brief Hook (OVR-01)
// ----------------------------
// Fetches the pre-computed morning brief for the current shop.
// Cache-first on backend — returns 204 if trust not eligible.
//
// Usage:
//   const brief = useMorningBriefSnapshot();
//   if (brief.isSuccess && brief.data) { ... }
//
// CHANGE POLICY:
//   Signal shape mirrors MorningBriefSnapshot in overviewMorningBrief.resolver.ts.
//   Deep links are backend-generated — never construct them in the frontend.

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface MorningBriefSignal {
  id: string;
  priority: 1 | 2 | 3 | 4 | 5;
  title: string;
  detail: string;
  module: string;
  deepLink: string;
  revenueImpact: number | null;
}

export interface MorningBriefData {
  signals: MorningBriefSignal[];
  hasUrgentIssues: boolean;
  generatedAt: string;
  trustWarning: boolean;
  fromCache: boolean;
  greeting: string | null;
  summaryLine: string | null;
}

const MORNING_BRIEF_QUERY_KEY = ['overview', 'morning-brief'] as const;

async function fetchMorningBrief(force = false): Promise<MorningBriefData | null> {
  const { data, status } = await axiosInstance.get(
    `/api/v1/modules/overview/morning-brief${force ? '?force=true' : ''}`,
    { validateStatus: (s: number) => s === 200 || s === 204 }
  );
  // 204 = trust not eligible — no brief available
  if (status === 204) return null;
  return data as MorningBriefData;
}

export function useMorningBriefSnapshot(enabledOrLegacyForce = true, enabledOverride?: boolean) {
  const enabled = enabledOverride ?? enabledOrLegacyForce;
  const legacyForce = enabledOverride !== undefined && enabledOrLegacyForce === true;
  const queryClient = useQueryClient();
  const refreshInFlightRef = useRef(false);
  const previousLegacyForceRef = useRef(false);

  const query = useQuery<MorningBriefData | null>({
    queryKey: MORNING_BRIEF_QUERY_KEY,
    enabled,
    queryFn: () => fetchMorningBrief(false),
    // Refresh every 15 minutes — matches backend cache window
    staleTime: (query) => query.state.data === null ? 0 : 15 * 60 * 1000,
    refetchInterval: (query) =>
      query.state.data === null || query.state.status === 'error' ? 10 * 1000 : false,
    retry: 3,
  });

  const refreshMutation = useMutation({
    mutationFn: () => fetchMorningBrief(true),
    onSuccess: (data) => {
      queryClient.setQueryData(MORNING_BRIEF_QUERY_KEY, data);
    },
  });
  const { isPending: isRefreshingBrief, mutateAsync: mutateRefreshBrief } = refreshMutation;

  const refreshMorningBrief = useCallback(async () => {
    if (refreshInFlightRef.current || isRefreshingBrief) {
      return queryClient.getQueryData<MorningBriefData | null>(MORNING_BRIEF_QUERY_KEY);
    }

    refreshInFlightRef.current = true;
    try {
      return await mutateRefreshBrief();
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [isRefreshingBrief, mutateRefreshBrief, queryClient]);

  useEffect(() => {
    if (!legacyForce) {
      previousLegacyForceRef.current = false;
      return;
    }

    if (enabled && !previousLegacyForceRef.current) {
      previousLegacyForceRef.current = true;
      void refreshMorningBrief();
    }
  }, [enabled, legacyForce, refreshMorningBrief]);

  return {
    ...query,
    refreshMorningBrief,
    isRefreshingBrief,
  };
}
