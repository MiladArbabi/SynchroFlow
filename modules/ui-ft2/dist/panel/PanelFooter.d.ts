/**
 * PanelFooter
 * -----------
 * Interpretation rail for FT2Panel.
 *
 * Replaces InfoBlockFooter.
 *
 * Responsibilities:
 *  - render contextual interpretation lines
 *  - provide visual separation from panel rows
 *
 * No layout logic.
 * No business semantics.
 */
export interface PanelFooterProps {
    line1: string;
    line2?: string;
}
export declare function PanelFooter({ line1, line2 }: PanelFooterProps): import("react/jsx-runtime").JSX.Element;
