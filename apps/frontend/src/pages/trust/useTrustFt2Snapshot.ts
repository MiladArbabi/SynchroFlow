import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type TrustFt2Snapshot = {
  trustEligible: boolean | null;
} | null;

/**
 * Trust FT2 Snapshot
 * ------------------
 * - Fetch-only
 * - Read-only
 * - Epistemically terminal
 * - No mapping
 * - No inference
 * - null = not evaluated / unknown
 *
 * Reusable across all FT2 pages.
 */
export function useTrustFt2Snapshot() {
  return useQuery<TrustFt2Snapshot>({
    queryKey: ['ft2', 'trust'],
    queryFn: async () => {
    /**
     * Trust FT2 must use the same authenticated transport
     * as all other FT2 snapshot hooks.
     *
     * No inference. No retries. No fabrication.
     */
    const res = await axiosInstance.get('/api/v1/modules/trust/ft2', {
        validateStatus: () => true,
    });

    // Epistemic absence is a valid state
    if (res.status === 204) {
        return null;
    }

    // Any non-success (auth, entitlement, transport) collapses to absence
    if (res.status !== 200) {
        return null;
    }

    return res.data as TrustFt2Snapshot;
    },

    // Trust is terminal, not volatile UI data
    staleTime: 60_000,
    retry: false,
  });
}