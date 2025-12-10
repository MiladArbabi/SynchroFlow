"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpecterFallbackManager = void 0;
//modules/specter/src/resilience/specter-fallback-manager.ts
const specter_customer_intelligence_service_1 = require("../public/specter-customer-intelligence-service");
/**
 * Minimal SpecterFallbackManager
 * - Provides a stable, DB-safe default CustomerSignalResult so onboarding/tests can run.
 * - Future work: integrate ModulePresence, orderNexus client, local history, enrichment.
 */
class SpecterFallbackManager {
    constructor() {
        // placeholder for DI in future (modulePresenceManager, orderNexusClient, etc.)
    }
    async getCustomerSignalWithFallbacks(shopId, hashedCustomerId) {
        // Return a conservative default signal. This is intentionally simple for FT0/FT1
        const signal = (0, specter_customer_intelligence_service_1.createDefaultCustomerSignal)(shopId, hashedCustomerId ?? 'anonymous');
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
exports.SpecterFallbackManager = SpecterFallbackManager;
//# sourceMappingURL=specter-fallback-manager.js.map