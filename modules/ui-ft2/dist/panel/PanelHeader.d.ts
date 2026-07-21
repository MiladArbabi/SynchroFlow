/**
 * PanelHeader
 * -----------
 * Dedicated header primitive for FT2 panels.
 *
 * Responsibilities
 * ----------------
 * - Render panel title
 * - Provide consistent header layout
 * - Apply title typography and header surface styling
 *
 * Must only be used inside FT2Panel.
 */
export type PanelHeaderProps = {
    title: string;
};
export declare function PanelHeader({ title }: PanelHeaderProps): import("react/jsx-runtime").JSX.Element;
