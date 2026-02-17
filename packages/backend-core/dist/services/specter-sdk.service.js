export class SpecterSDKService {
    constructor(config) {
        this.config = config;
        this.sessionData = this.initializeSession();
    }
    initializeSession() {
        const baseSession = {
            sessionId: this.generateSessionId(),
            timestamp: new Date(),
            moduleTier: this.config.moduleTier
        };
        // Enhance session data based on module tier
        if (this.config.moduleTier !== 'free') {
            return {
                ...baseSession,
                intentScore: this.calculateIntentScore(),
                pageViews: 1,
                productsViewed: []
            };
        }
        return baseSession;
    }
    generateSessionId() {
        return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    trackSession() {
        if (this.config.moduleTier !== 'free') {
            // Enhanced tracking for paid tiers
            this.sessionData.pageViews = (this.sessionData.pageViews || 0) + 1;
            this.sessionData.intentScore = this.calculateIntentScore();
        }
        return { ...this.sessionData };
    }
    getConfig() {
        return { ...this.config };
    }
    getSessionData() {
        return { ...this.sessionData };
    }
    shouldShowNudge(nudgeType) {
        // Free tier never shows nudges
        if (this.config.moduleTier === 'free') {
            return false;
        }
        // Check if feature is enabled for this tier
        if (nudgeType === 'exit_intent' && !this.config.features.exitIntent) {
            return false;
        }
        if (nudgeType === 'basic_nudge' && !this.config.features.basicNudges) {
            return false;
        }
        // Intent-based nudge triggering for specter+ tiers
        if (this.config.moduleTier === 'specter' && this.sessionData.intentScore) {
            return this.sessionData.intentScore > 0.7;
        }
        return false;
    }
    getNudgeConfiguration(nudgeType) {
        if (!this.shouldShowNudge(nudgeType)) {
            return null;
        }
        const baseConfig = {
            nudgeType,
            sessionId: this.sessionData.sessionId,
            intentScore: this.sessionData.intentScore,
            timestamp: new Date()
        };
        // Customize nudge based on type
        switch (nudgeType) {
            case 'exit_intent':
                return {
                    ...baseConfig,
                    trigger: 'mouse_leave',
                    offerType: 'discount',
                    discountPercentage: 10,
                    message: "Wait! Get 10% off before you go"
                };
            case 'basic_nudge':
                return {
                    ...baseConfig,
                    trigger: 'scroll_depth',
                    offerType: 'free_shipping',
                    threshold: 75,
                    message: "Free shipping on your order!"
                };
            default:
                return baseConfig;
        }
    }
    // Make calculateIntentScore public for testing
    calculateIntentScore() {
        // Basic intent scoring - will be enhanced with ML in future iterations
        const baseScore = Math.random() * 0.3; // 0-0.3 base random
        const pageViewBonus = 0.2; // Additional for page views
        const timeOnSiteBonus = 0.5; // Additional for engagement
        return Math.min(baseScore + pageViewBonus + timeOnSiteBonus, 1.0);
    }
}
