/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/themes/overrides/Typography.ts
import { Theme } from '@mui/material/styles';
import { Components, ComponentsVariants } from '@mui/material/styles';
import { TypographyProps } from '@mui/material/Typography'; // Import TypographyProps

// Type for the config entry
type TypographyComponentConfig = Components<Theme>['MuiTypography'];

// ==============================|| OVERRIDES - TYPOGRAPHY ||============================== //

export default function Typography(theme: Theme): TypographyComponentConfig {
    // Use CSS variable references instead of resolved palette values.
    // Resolved palette values are captured at theme build time and do NOT
    // update when color scheme switches — causing dark mode to render
    // light mode colors. CSS vars resolve at paint time per active scheme.
    const typographyVariants: ComponentsVariants['MuiTypography'] = [
        { props: { variant: 'h1' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'h2' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'h3' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'h4' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'h5' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'h6' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'subtitle1' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'subtitle2' }, style: { color: 'var(--mui-palette-text-secondary)' } },
        { props: { variant: 'caption' }, style: { color: 'var(--mui-palette-text-secondary)' } },
        { props: { variant: 'body1' }, style: { color: 'var(--mui-palette-text-primary)' } },
        { props: { variant: 'body2' }, style: { color: 'var(--mui-palette-text-primary)' } },
    ];

    return {
        // styleOverrides can still be used for global/class key styles
        styleOverrides: {
            root: {
                // Example global style
                // marginBottom: theme.spacing(1),
            },
            // Example class key override
            // gutterBottom: {
            //    marginBottom: theme.spacing(1.5),
            // },
        },
        // --- FIX: Use variants array for prop-based styles ---
        variants: typographyVariants
    };
}