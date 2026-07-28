import type { ReactNode } from 'react';
export interface EntityDetailModalProps {
    /** Drives both open state and remount-on-change — pass the entity id. */
    entityId: string | number | null;
    onClose: () => void;
    /** Primary header text, e.g. "Order #1048" */
    title: ReactNode;
    /** Optional header sub-line, e.g. status phrase or member role */
    subtitle?: ReactNode;
    /** Optional header-right content (status badges, etc.) — renders before the close button */
    headerActions?: ReactNode;
    /** True while any underlying query is loading */
    isLoading?: boolean;
    /** Non-null renders an error state instead of children */
    errorMessage?: string | null;
    /** Body content — each module supplies its own */
    children?: ReactNode;
    /**
     * FOOTER ACTIONS (2026-07-02)
     * ---------------------------
     * Optional fixed footer region, visually --bg-2 (matches header) to
     * frame the --surface-toned body per target design. Consumer supplies
     * its own CTA row — shell has zero entity-specific button logic, same
     * separation as the rest of this file. Omit for entities with no
     * footer actions; the region simply doesn't render.
     */
    footerActions?: ReactNode;
    /** Default 'lg' — override only with a specific reason */
    maxWidth?: 'md' | 'lg' | 'xl';
}
export declare function EntityDetailModal({ entityId, onClose, title, subtitle, headerActions, isLoading, errorMessage, children, footerActions, maxWidth, }: EntityDetailModalProps): import("react").JSX.Element;
//# sourceMappingURL=EntityDetailModal.d.ts.map