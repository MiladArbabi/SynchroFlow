import { ModuleId } from './onboarding.js';
export type ModuleAccessState = 'visible' | 'free_tier_active' | 'free_tier_exhausted' | 'locked';
export interface ModuleFreeTierPolicy {
    enabled: boolean;
    maxUnits: number | null;
    metric: 'orders' | 'skus' | 'returns' | 'nudges' | 'insights' | 'tasks' | 'pos';
    softWarningThreshold?: number;
    upgradeRoute: string;
    lockedMessage: string;
    resetPeriod: 'monthly';
}
export interface ModuleConfig {
    moduleId: ModuleId;
    freeTier: ModuleFreeTierPolicy;
}
export declare const MODULE_FREE_TIER_POLICIES: Record<ModuleId, ModuleFreeTierPolicy>;
export type ModuleEntitlementAccess = 'allowed' | 'free-tier' | 'locked';
export interface ModuleAccessComputationInput {
    moduleId: ModuleId;
    usageCount: number | null;
    entitlementAccess: ModuleEntitlementAccess;
}
export interface ModuleAccessComputationResult {
    state: ModuleAccessState;
    /**
     * Remaining units in this period.
     * null = not applicable / unlimited (e.g., paid plan, disabled FTEP, or unlimited policy).
     */
    remaining: number | null;
}
export declare function computeModuleAccessState(input: ModuleAccessComputationInput): ModuleAccessComputationResult;
//# sourceMappingURL=free-tier.d.ts.map