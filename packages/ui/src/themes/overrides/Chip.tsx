/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/Chip.tsx
import { Theme } from '@mui/material/styles';
import { ChipProps, chipClasses, ChipClassKey } from '@mui/material/Chip';
import { ComponentsOverrides, ComponentsVariants, Components } from '@mui/material/styles';
import { withAlpha } from 'utils/colorUtils';

// --- Type Definitions ---
// --- FIX: Use the correct type for the component's config ---
type ChipComponentConfig = Components<Theme>['MuiChip'];

type ChipOwnerState = { ownerState: ChipProps; theme: Theme };

// ===============================||  OVERRIDES - CHIP  ||=============================== //

export default function Chip(theme: Theme): ChipComponentConfig { // Use the correct return type

    const getPaletteColor = (color: ChipProps['color']) => {
        if (!color || color === 'default') { return undefined; }
        return (theme.palette as any)[color] as import('@mui/material/styles').PaletteColor | undefined;
    };

    const lightVariantStyle = ({ ownerState, theme }: ChipOwnerState) => {
        const paletteColor = getPaletteColor(ownerState.color);
        if (!paletteColor) return {};
        const isDark = theme.palette.mode === 'dark';
        const isWarningOrSuccess = ownerState.color === 'warning' || ownerState.color === 'success';
        let styles = {
            color: isWarningOrSuccess ? paletteColor.dark : paletteColor.main,
            backgroundColor: ownerState.color === 'error' ? withAlpha(paletteColor.light || '#ef9a9a', 0.25) :
                             ownerState.color === 'success' ? withAlpha(paletteColor.light || '#b9f6ca', 0.5) :
                             paletteColor.light || theme.palette.grey[100],
            [`&.${chipClasses.clickable}:hover`]: {
                color: paletteColor.light || theme.palette.common.white,
                backgroundColor: paletteColor.dark || paletteColor.main,
            }
        };
        if (isDark) {
            styles = {
                ...styles,
                color: isWarningOrSuccess ? paletteColor.main : paletteColor.light,
                backgroundColor: withAlpha(paletteColor.dark || paletteColor.main, 0.15),
                [`&.${chipClasses.clickable}:hover`]: {
                    color: paletteColor.dark || paletteColor.main,
                    backgroundColor: paletteColor.light || theme.palette.common.white,
                }
            };
        }
        return styles;
    };

    return {
        defaultProps: {
            color: 'primary',
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
                    borderColor: theme.palette.warning.dark,
                    color: theme.palette.warning.dark,
                }
            },
            {
                props: { variant: 'outlined', color: 'success' },
                style: {
                    borderColor: theme.palette.success.dark,
                    color: theme.palette.success.dark,
                }
            },
        ]
    };
}