import { SpecterCustomerSignal } from '../public/specter-customer-intelligence-service';
export type CustomerSignalResult = {
    signal: SpecterCustomerSignal;
    source: 'specter' | 'fallback' | 'default';
    confidence: number;
    dataSources: {
        orderNexus: boolean;
        skuOs: boolean;
        finance: boolean;
    };
};
/**
 * Minimal SpecterFallbackManager
 * - Provides a stable, DB-safe default CustomerSignalResult so onboarding/tests can run.
 * - Future work: integrate ModulePresence, orderNexus client, local history, enrichment.
 */
export declare class SpecterFallbackManager {
    constructor();
    getCustomerSignalWithFallbacks(shopId: number, hashedCustomerId: string): Promise<CustomerSignalResult>;
}
