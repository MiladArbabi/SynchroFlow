/**
 * PanelRow
 * --------
 * Row primitive for FT2Panel.
 *
 * Replaces InfoBlockRow.
 *
 * Responsibilities:
 *  - label/value rendering
 *  - optional diff indicator
 *
 * No layout logic.
 * No panel semantics.
 *
 * Parent container (FT2Panel) owns layout.
 */
export type PanelRowDiffTone = 'up' | 'down' | 'neutral';
export type PanelRowDiffPosition = 'left' | 'right';
export interface PanelRowProps {
    label: string;
    value: string | number | null;
    diff?: string | null;
    diffTone?: PanelRowDiffTone;
    diffPosition?: PanelRowDiffPosition;
}
export declare function PanelRow({ label, value, diff, diffTone, diffPosition, }: PanelRowProps): import("react/jsx-runtime").JSX.Element;
