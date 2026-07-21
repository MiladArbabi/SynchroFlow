export type ProductsDiagnosticCardProps = {
    title: string;
    message: string;
    ctaLabel?: string;
    onCtaClick?: () => void;
    testId?: string;
};
/**
 * ProductsDiagnosticCard
 * ----------------------
 * FT1-presentational diagnostic surface.
 *
 * Invariants:
 * - No logic
 * - No routing
 * - No lifecycle awareness
 * - One message, one optional CTA
 */
export declare function ProductsDiagnosticCard({ title, message, ctaLabel, onCtaClick, testId, }: ProductsDiagnosticCardProps): import("react/jsx-runtime").JSX.Element;
