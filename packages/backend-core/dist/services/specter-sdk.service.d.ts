export interface SpecterSDKConfig {
    shopId: string;
    moduleTier: 'free' | 'specter' | 'growth' | 'operations';
    features: {
        sessionTracking: boolean;
        basicNudges: boolean;
        exitIntent: boolean;
        surgicalDiscounts: boolean;
    };
}
export interface SessionData {
    sessionId: string;
    timestamp: Date;
    moduleTier: string;
    intentScore?: number;
    pageViews?: number;
    productsViewed?: string[];
}
export declare class SpecterSDKService {
    private config;
    private sessionData;
    constructor(config: SpecterSDKConfig);
    private initializeSession;
    private generateSessionId;
    trackSession(): SessionData;
    getConfig(): SpecterSDKConfig;
    getSessionData(): SessionData;
    shouldShowNudge(nudgeType: string): boolean;
    getNudgeConfiguration(nudgeType: string): {
        nudgeType: string;
        sessionId: string;
        intentScore: number | undefined;
        timestamp: Date;
    } | {
        trigger: string;
        offerType: string;
        discountPercentage: number;
        message: string;
        nudgeType: string;
        sessionId: string;
        intentScore: number | undefined;
        timestamp: Date;
    } | {
        trigger: string;
        offerType: string;
        threshold: number;
        message: string;
        nudgeType: string;
        sessionId: string;
        intentScore: number | undefined;
        timestamp: Date;
    } | null;
    calculateIntentScore(): number;
}
