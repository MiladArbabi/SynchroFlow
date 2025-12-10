export interface SpecterCustomerSignal {
    shopId: number;
    hashedCustomerId: string;
    specterCustomerTier: 'VIP' | 'CORE' | 'PROMO_DEPENDENT' | 'RISKY' | 'UNKNOWN';
    predictedLTV: number;
    churnRisk: number;
    priceSensitivity: number;
    returnsRisk: number;
    updatedAt: string;
}
export declare function createDefaultCustomerSignal(shopId: number, hashedCustomerId: string): SpecterCustomerSignal;
export default class SpecterCustomerIntelligenceService {
    /**
     * Public API: getCustomerSignal(shopId, hashedCustomerId | null)
     * v1 behavior: returns a default signal (anonymous) — safe for all consumers.
     *
     * Keep signature stable; implementation can be replaced with a more
     * complete SpecterFallbackManager later without changing callers.
     */
    getCustomerSignal(shopId: number, hashedCustomerId: string | null): Promise<SpecterCustomerSignal>;
}
