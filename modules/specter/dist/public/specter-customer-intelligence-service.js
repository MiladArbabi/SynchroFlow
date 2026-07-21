// modules/specter/src/public/specter-customer-intelligence-service.ts
// Minimal SpecterCustomerIntelligenceService stub used by backend providers/tests.
//
// This is intentionally lightweight: it implements the public API surface used
// by readiness.providers and the test-suite. Replace/extend it later with the
// full Specter implementation (fallback manager, enrichment, caching, etc).
export function createDefaultCustomerSignal(shopId, hashedCustomerId) {
    return {
        shopId,
        hashedCustomerId,
        specterCustomerTier: 'UNKNOWN',
        predictedLTV: 0,
        churnRisk: 0.5,
        priceSensitivity: 0.5,
        returnsRisk: 0.1,
        updatedAt: new Date().toISOString()
    };
}
export default class SpecterCustomerIntelligenceService {
    /**
     * Public API: getCustomerSignal(shopId, hashedCustomerId | null)
     * v1 behavior: returns a default signal (anonymous) — safe for all consumers.
     *
     * Keep signature stable; implementation can be replaced with a more
     * complete SpecterFallbackManager later without changing callers.
     */
    async getCustomerSignal(shopId, hashedCustomerId) {
        const id = hashedCustomerId ?? 'anonymous';
        return createDefaultCustomerSignal(shopId, id);
    }
}
//# sourceMappingURL=specter-customer-intelligence-service.js.map