/**
 * PanelBlock
 * ----------
 * Structural grouping primitive for FT2Panel.
 *
 * Responsibilities
 * ----------------
 * - Group rows, actions, and secondary rows
 * - Provide consistent vertical spacing
 * - Prevent layout leakage from raw HTML containers
 *
 * Must only be used inside FT2Panel.
 */
import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
export type PanelBlockProps = {
    children: ReactNode;
    /**
     * Optional DOM anchor.
     *
     * Allows operational surfaces to attach
     * navigation targets without leaking DOM
     * manipulation logic into the layout system.
     */
    id?: string;
    /**
     * Optional style overrides.
     */
    sx?: SxProps<Theme>;
};
export declare function PanelBlock({ children, id, sx }: PanelBlockProps): import("react/jsx-runtime").JSX.Element;
