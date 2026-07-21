export type SpecterDiagnosticCardProps = {
    title: string;
    message: string;
    ctaLabel?: string;
    onCtaClick?: () => void;
    testId?: string;
};
/**
 * SpecterDiagnosticCard
 * ---------------------
 * FT1-presentational diagnostic surface.
 *
 * MUST mirror OrderNexusDiagnosticCard exactly.
 */
export declare function SpecterDiagnosticCard({ title, message, ctaLabel, onCtaClick, testId, }: SpecterDiagnosticCardProps): import("react/jsx-runtime").JSX.Element;
