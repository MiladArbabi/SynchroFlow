/**
 * WMS CONNECTION BADGE (WM-24)
 * -----------------------------
 * Always-visible connection indicator for WMS operator UI.
 * Shows queued scan count when offline so operator knows
 * scans are safely stored and will sync on reconnect.
 *
 * Renders inline — place in pick/pack session header.
 */
interface WmsConnectionBadgeProps {
    isOnline: boolean;
    queuedCount: number;
}
export declare function WmsConnectionBadge({ isOnline, queuedCount }: WmsConnectionBadgeProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=WmsConnectionBadge.d.ts.map