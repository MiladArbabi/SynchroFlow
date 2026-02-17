export interface TrustFt2Snapshot {
    dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
    trustEligible: boolean;
}
export declare function getTrustFt2Snapshot(input: {
    shopId: number;
}): Promise<TrustFt2Snapshot>;
