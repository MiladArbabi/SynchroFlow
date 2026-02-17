// apps/backend/src/services/trust-ft2/trustFt2.resolver.ts

export interface TrustFt2Snapshot {
  dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
  trustEligible: boolean;
}

export async function getTrustFt2Snapshot(input: {
  shopId: number;
}): Promise<TrustFt2Snapshot> {
  // Minimal stub — replace with real trust logic later
  return {
    dataFreshness: 'unknown',
    trustEligible: true,
  };
}
