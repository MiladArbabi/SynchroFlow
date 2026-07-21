export type GlobalPhase = 'FT-1' | 'FT0-A' | 'FT0-B' | 'FT1' | 'FT2';
export type GlobalState = 'blind' | 'syncing' | 'limited' | 'active' | 'paywalled';
export type ModuleState = 'locked' | 'syncing' | 'limited' | 'active' | 'paywalled';
export interface LifecycleContext {
    lifecyclePhase: 'FT-1' | 'FT0' | 'FT1' | 'FT2';
    readinessSnapshot: any | null;
    userState: {
        user: {
            shopify_connected: boolean;
            first_insight_delivered: boolean;
        };
    };
}
export interface ActivationSession {
    hasShownFT0Modal: boolean;
}
export interface ActivationSurface {
    global: {
        phase: GlobalPhase;
        state: GlobalState;
        reason?: string;
    };
    modules: Record<string, {
        state: ModuleState;
        limits?: {
            orders?: number;
        };
        cta?: {
            type: 'connect' | 'wait' | 'upgrade';
            action: string;
        };
    }>;
    ux: {
        showFT0Modal: boolean;
    };
}
/**
 * Canonical activation surface derivation.
 * This is the ONLY place allowed to translate lifecycle → UX state.
 */
export declare function deriveActivationSurface(ctx: LifecycleContext, session: ActivationSession, moduleIds: string[]): ActivationSurface;
//# sourceMappingURL=deriveActivationSurface.d.ts.map