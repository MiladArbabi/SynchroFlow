/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/Typography.ts
import { Theme } from '@mui/material/styles';
import { Components, ComponentsVariants } from '@mui/material/styles'; // Import ComponentsVariants
import { TypographyProps } from '@mui/material/Typography'; // Import TypographyProps

// Type for the config entry
type TypographyComponentConfig = Components<Theme>['MuiTypography'];

// ==============================|| OVERRIDES - TYPOGRAPHY ||============================== //

export default function Typography(theme: Theme): TypographyComponentConfig {
    // Define headingColor using standard palette access
    // Choose appropriate key, e.g., text.primary or a specific grey shade
    const headingColor = theme.palette.text.primary; // Adjusted from text.heading/text.dark
    const secondaryColor = theme.palette.text.secondary; // Standard secondary color

    // Define variant styles using the variants array
    const typographyVariants: ComponentsVariants['MuiTypography'] = [
        {
            props: { variant: 'h1' },
            style: { color: headingColor }
        },
        {
            props: { variant: 'h2' },
            style: { color: headingColor }
        },
        {
            props: { variant: 'h3' },
            style: { color: headingColor }
        },
        {
            props: { variant: 'h4' },
            style: { color: headingColor }
        },
        {
            props: { variant: 'h5' },
            style: { color: headingColor }
        },
        {
            props: { variant: 'h6' },
            style: { color: headingColor }
        },
        {
            props: { variant: 'subtitle1' },
            style: { color: headingColor } // Adjusted from text.dark
        },
        {
            props: { variant: 'subtitle2' },
            style: { color: secondaryColor }
        },
        {
            props: { variant: 'caption' },
            style: { color: secondaryColor }
        },
        {
            props: { variant: 'body1' }, // Standard body text
            style: { color: theme.palette.text.primary }
        },
        {
            props: { variant: 'body2' },
            style: { color: theme.palette.text.primary } // Adjusted from text.primary (assuming default body text)
        },
        // Add other variant overrides if needed (e.g., button, overline)
    ];

    return {
        // Define default props if necessary
        // defaultProps: {
        //    variantMapping: { ... } // Example
        // },
        // Use styleOverrides for global styles or specific class keys
        styleOverrides: {
            root: {
                // Global styles for all Typography components
                // Example: marginTop: theme.spacing(1),
            },
            // Override specific class keys if needed
            // gutterBottom: {
            //     marginBottom: theme.spacing(1.5),
            // },
            // paragraph: {
            //     marginBottom: theme.spacing(2),
            // }
        },
        // Use variants array for prop-based conditional styling
        variants: typographyVariants
    };
}