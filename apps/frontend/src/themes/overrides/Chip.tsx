/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/themes/overrides/Chip.tsx
import { Theme } from '@mui/material/styles';
import { chipClasses } from '@mui/material/Chip';
import { Components } from '@mui/material/styles';

// --- Type Definitions ---
// --- FIX: Use the correct type for the component's config ---
type ChipComponentConfig = Components<Theme>['MuiChip'];


// ===============================||  OVERRIDES - CHIP  ||=============================== //

export default function Chip(_theme: Theme): ChipComponentConfig { // Use the correct return type

    // Token-driven tones (themes/tokens.ts). Overrides are built once, so the
    // previous palette.mode branches never saw dark; CSS vars resolve per scheme.
    const TONES: Record<string, { fg: string; bg: string; border: string }> = {
        primary: { fg: 'var(--accent-text)', bg: 'var(--accent-ghost)', border: 'var(--accent-border)' },
        secondary: { fg: 'var(--ink-2)', bg: 'var(--bg-3)', border: 'var(--rule-2)' },
        info: { fg: 'var(--ink-2)', bg: 'var(--bg-3)', border: 'var(--rule-2)' },
        success: { fg: 'var(--good-ink)', bg: 'var(--good-ghost)', border: 'var(--good-border)' },
        warning: { fg: 'var(--warning-text)', bg: 'var(--warning-ghost)', border: 'var(--warning-border)' },
        error: { fg: 'var(--critical-text)', bg: 'var(--critical-ghost)', border: 'var(--critical-border)' },
    };

    const lightVariantStyle = ({ ownerState }: any) => {
        const tone = ownerState.color ? TONES[ownerState.color] : undefined;
        if (!tone) return {};
        return {
            color: tone.fg,
            backgroundColor: tone.bg,
            [`&.${chipClasses.clickable}:hover`]: {
                color: tone.fg,
                backgroundColor: tone.bg,
                filter: 'brightness(0.97)',
            },
        };
    };

    return {
        // Neutral by default: primary is the action accent and must be opted into.
        defaultProps: {
            color: 'default',
        },
        // --- FIX: Restore the styleOverrides key ---
        styleOverrides: {
            // --- FIX: Place class key overrides INSIDE styleOverrides ---
            deleteIcon: {
                color: 'inherit',
                opacity: 0.7,
                '&:hover': {
                    opacity: 1
                }
            },
            // root: { // Example root override if needed
            //    fontSize: '0.8rem',
            // }
        },
        // variants remains a sibling
        variants: [
            {
                props: { variant: 'light' },
                style: lightVariantStyle
            },
            {
                props: { variant: 'outlined', color: 'warning' },
                style: {
                    borderColor: 'var(--warning-border)',
                    color: 'var(--warning-text)',
                }
            },
            {
                props: { variant: 'outlined', color: 'success' },
                style: {
                    borderColor: 'var(--good-border)',
                    color: 'var(--good-ink)',
                }
            },
        ]
    };
}