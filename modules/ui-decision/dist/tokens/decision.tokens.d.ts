/**
 * Decision Design Tokens
 * -----------------------
 * Strictly separated from FT2 tokens.
 *
 * Semantic Layer:
 * - Urgency
 * - Ranking
 * - Priority emphasis
 *
 * Must NOT import from ui-ft2.
 */
export declare const decisionTokens: {
    readonly spacing: {
        readonly stackGap: 12;
    };
    readonly surface: {
        readonly background: "#111111";
        readonly border: "#2A2A2A";
    };
    readonly urgency: {
        readonly high: "#B00020";
        readonly medium: "#FF6F00";
        readonly low: "#2E7D32";
    };
};
