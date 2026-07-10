// apps/frontend/src/hooks/useSpotlight.ts
//
// T7 — per-surface spotlight dismissal hook.
// Reads from /api/v1/user-state/onboarding-flags (shared cache with checklist).
// Writes via POST /api/v1/user-state/spotlight/:key/dismiss.
//
// See docs/playbooks/onboarding-progressive-disclosure-playbook.md §2 Layer 2.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from '../api/axiosConfig';

export function useSpotlight(key: string) {
  const qc = useQueryClient();

  const { data: flags, isLoading } = useQuery<Record<string, boolean>>({
    queryKey: ['user-state', 'onboarding-flags'],
    queryFn: async () => (await axiosInstance.get('/api/v1/user-state/onboarding-flags')).data,
    staleTime: 60_000,
  });

  const { mutate: dismiss } = useMutation({
    mutationFn: () => axiosInstance.post(`/api/v1/user-state/spotlight/${key}/dismiss`),
    // Optimistic update — hide immediately, revalidate in background.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['user-state', 'onboarding-flags'] });
      const prev = qc.getQueryData<Record<string, boolean>>(['user-state', 'onboarding-flags']);
      qc.setQueryData(['user-state', 'onboarding-flags'], (old: Record<string, boolean> = {}) => ({
        ...old,
        [`spotlight:dismissed:${key}`]: true,
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['user-state', 'onboarding-flags'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['user-state', 'onboarding-flags'] }),
  });

  const isDismissed = flags?.[`spotlight:dismissed:${key}`] ?? false;

  return { isDismissed, isLoading, dismiss };
}