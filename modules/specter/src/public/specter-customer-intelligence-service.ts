// modules/specter/src/public/specter-customer-intelligence-service.ts
// Minimal SpecterCustomerIntelligenceService stub used by backend providers/tests.
//
// This is intentionally lightweight: it implements the public API surface used
// by readiness.providers and the test-suite. Replace/extend it later with the
// full Specter implementation (fallback manager, enrichment, caching, etc).

export interface SpecterCustomerSignal {
  shopId: number;
  hashedCustomerId: string;
  specterCustomerTier: 'VIP' | 'CORE' | 'PROMO_DEPENDENT' | 'RISKY' | 'UNKNOWN';
  predictedLTV: number;
  churnRisk: number;        // 0..1
  priceSensitivity: number; // 0..1
  returnsRisk: number;      // 0..1
  updatedAt: string;        // ISO
}

export function createDefaultCustomerSignal(
  shopId: number,
  hashedCustomerId: string
): SpecterCustomerSignal {
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
  async getCustomerSignal(
    shopId: number,
    hashedCustomerId: string | null
  ): Promise<SpecterCustomerSignal> {
    const id = hashedCustomerId ?? 'anonymous';
    return createDefaultCustomerSignal(shopId, id);
  }
}
