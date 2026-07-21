export type FT2SignalBannerSeverity = 'critical' | 'warning' | 'info';
export type FT2SignalBannerProps = {
    severity?: FT2SignalBannerSeverity;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
};
/**
 * FT2 SIGNAL BANNER
 * -----------------
 * Reusable operational signal surface.
 *
 * Design purpose:
 * - highlight operational incidents
 * - surface actionable system signals
 * - support rapid operator scanning
 *
 * Used across FT2 modules (orders, inventory, finance, etc).
 */
export declare function FT2SignalBanner({ severity, title, description, actionLabel, onAction, }: FT2SignalBannerProps): import("react/jsx-runtime").JSX.Element;
