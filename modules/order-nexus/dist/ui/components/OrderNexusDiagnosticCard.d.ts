export type OrderNexusDiagnosticCardProps = {
    title: string;
    message: string;
    ctaLabel?: string;
    onCtaClick?: () => void;
    testId?: string;
};
/**
 * OrderNexusDiagnosticCard
 * ------------------------
 * FT1-presentational diagnostic surface.
 *
 * Invariants:
 * - No logic
 * - No routing
 * - No lifecycle awareness
 * - One message, one optional CTA
 */
export declare function OrderNexusDiagnosticCard({ title, message, ctaLabel, onCtaClick, testId, }: OrderNexusDiagnosticCardProps): import("react").JSX.Element;
