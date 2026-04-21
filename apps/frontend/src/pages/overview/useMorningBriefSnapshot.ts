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

import { useQuery } from '@tanstack/react-query';
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

export function useMorningBriefSnapshot(force = false) {
  return useQuery<MorningBriefData | null>({
    queryKey: ['overview', 'morning-brief', force],
    queryFn: async () => {
      const { data, status } = await axiosInstance.get(
        `/api/v1/modules/overview/morning-brief${force ? '?force=true' : ''}`,
        { validateStatus: (s: number) => s === 200 || s === 204 }
      );
      // 204 = trust not eligible — no brief available
      if (status === 204) return null;
      return data as MorningBriefData;
    },
    // Refresh every 15 minutes — matches backend cache window
    staleTime: 15 * 60 * 1000,
  });
}