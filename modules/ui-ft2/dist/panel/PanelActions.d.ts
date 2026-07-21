/**
 * PanelActions
 * ------------
 * Dedicated action zone for FT2 panels.
 *
 * Responsibilities
 * ----------------
 * - Render operational controls
 * - Maintain consistent spacing
 * - Prevent action controls from mixing with PanelRow layout
 *
 * Must be placed inside FT2Panel.
 */
import type { ReactNode } from 'react';
export type PanelActionsProps = {
    children: ReactNode;
};
export declare function PanelActions({ children }: PanelActionsProps): import("react/jsx-runtime").JSX.Element;
