export declare const FT2_TOKENS: {
    /**
     * Trust Tone Tokens
     * -----------------
     * Epistemic surface boundary indicators.
     * Non-judgmental. No semantic overload.
     */
    readonly trustTone: {
        readonly trusted: "#2E7D32";
        readonly constrained: "#F9A825";
        readonly blocked: "#C62828";
    };
    readonly layoutMaxWidth: 1440;
    readonly padding: {
        readonly desktop: 32;
        readonly tablet: 24;
        readonly mobile: 16;
    };
    readonly rowGap: 32;
    readonly surfaceGap: 64;
    readonly surfacePadding: {
        readonly kpi: 16;
        readonly standard: 24;
    };
    readonly surface: {
        /**
         * Surface background
         * ------------------
         * Slight lift from app background.
         * Actual color resolved by host theme.
         */
        readonly background: "var(--ft2-surface-bg)";
    };
    readonly surfaceTitle: {
        /**
         * Control zone background
         * -----------------------
         * Slight lift above surface.
         * Must remain neutral and non-semantic.
         */
        readonly background: "var(--ft2-surface-inset-bg)";
        readonly divider: "var(--ft2-surface-divider)";
    };
    /**
   * FT2 Typography Grammar
   * ---------------------
   * KPI-first. Dense. Non-decorative.
   * These tokens define semantic weight, not aesthetics.
   */
    readonly typography: {
        readonly surfaceTitle: {
            readonly fontSize: "12px";
            readonly fontWeight: 600;
            readonly lineHeight: 1.2;
            readonly letterSpacing: "0.04em";
            readonly textTransform: "uppercase";
            readonly color: "var(--mui-palette-text-secondary)";
        };
        readonly body: {
            readonly fontSize: "13px";
            readonly fontWeight: 400;
            readonly lineHeight: 1.4;
            readonly color: "var(--mui-palette-text-primary)";
        };
        readonly kpiValue: {
            readonly fontSize: "20px";
            readonly fontWeight: 600;
            readonly lineHeight: 1.1;
            readonly letterSpacing: "-0.01em";
            readonly color: "var(--mui-palette-text-primary)";
        };
        readonly kpiUnit: {
            readonly fontSize: "11px";
            readonly fontWeight: 500;
            readonly lineHeight: 1.1;
            readonly color: "var(--mui-palette-text-secondary)";
        };
        readonly hint: {
            readonly fontSize: "11px";
            readonly fontWeight: 400;
            readonly lineHeight: 1.3;
            readonly color: "var(--mui-palette-text-secondary)";
        };
    };
    readonly surfaceShadow: {
        /**
         * Structural shadow only.
         * Resolved by host theme (mode-aware).
         */
        readonly default: "var(--ft2-surface-shadow)";
        readonly hover: "var(--ft2-surface-shadow-hover)";
    };
    readonly controlZoneHeight: 32;
    readonly analyticalWidth: {
        readonly desktop: "85%";
        readonly tablet: "92%";
        readonly mobile: "100%";
    };
    /**
     * FT2 Row Grammar
     * ---------------
     * Semantic layout intents mapped to
     * deterministic geometry.
     */
    readonly row: {
        /**
         * KPI Tier
         * --------
         * Epistemic snapshot layer.
         */
        readonly kpi: {
            readonly height: 120;
        };
        /**
         * Decision Tier
         * -------------
         * Operational prioritization layer.
         *
         * Characteristics:
         * - Full-width
         * - Single-column
         * - Taller than analysis
         * - Sits directly below KPI
         *
         * Purpose:
         * - Surface urgency
         * - Drive attention
         * - Bridge KPI → Analysis
         */
        readonly decision: {
            readonly columns: 1;
            readonly height: 340;
        };
        /**
         * Analysis Tier
         * -------------
         * Multi-column breakdown layer.
         */
        readonly analysis: {
            readonly columns: 2;
            readonly height: 280;
        };
        /**
         * Support Tier
         * ------------
         * Contextual, secondary surfaces.
         */
        readonly support: {
            readonly columns: 3;
            readonly height: 160;
        };
    };
};
