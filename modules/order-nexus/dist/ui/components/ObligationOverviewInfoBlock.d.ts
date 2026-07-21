/**
 * ⚠️ FT2 UI COMPONENT
 * ------------------
 * Read-only.
 * Aggregate-only.
 *
 * This component MUST NOT:
 * - render attribution
 * - imply causes
 * - suggest actions
 */
type ObligationOverviewInfoBlockProps = {
    obligations: {
        coverage: {
            status: 'sufficient' | 'insufficient';
        };
    };
};
/**
 * Obligation Overview — FT2
 * -------------------------
 * Read-only visibility into constrained value.
 *
 * No actions.
 * No prioritization.
 * No guidance.
 */
export declare function ObligationOverviewInfoBlock({ obligations, }: ObligationOverviewInfoBlockProps): import("react/jsx-runtime").JSX.Element;
export {};
