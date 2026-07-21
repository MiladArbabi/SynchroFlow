//modules/specter/src/resilience/specter-fallback-manager.ts
import { createDefaultCustomerSignal, } from '../public/specter-customer-intelligence-service.js';
/**
 * Minimal SpecterFallbackManager
 * - Provides a stable, DB-safe default CustomerSignalResult so onboarding/tests can run.
 * - Future work: integrate ModulePresence, orderNexus client, local history, enrichment.
 */
export class SpecterFallbackManager {
    constructor() {
        // placeholder for DI in future (modulePresenceManager, orderNexusClient, etc.)
    }
    async getCustomerSignalWithFallbacks(shopId, hashedCustomerId) {
        // Return a conservative default signal. This is intentionally simple for FT0/FT1
        const signal = createDefaultCustomerSignal(shopId, hashedCustomerId ?? 'anonymous');
        return {
            signal,
            source: 'default',
            confidence: 0.1,
            dataSources: {
                orderNexus: false,
                skuOs: false,
                finance: false,
            },
        };
    }
}
//# sourceMappingURL=specter-fallback-manager.js.map