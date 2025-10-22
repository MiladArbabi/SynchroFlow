/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/Typography.ts
import { Theme } from '@mui/material/styles';
import { Components, ComponentsVariants } from '@mui/material/styles';
import { TypographyProps } from '@mui/material/Typography'; // Import TypographyProps

// Type for the config entry
type TypographyComponentConfig = Components<Theme>['MuiTypography'];

// ==============================|| OVERRIDES - TYPOGRAPHY ||============================== //

export default function Typography(theme: Theme): TypographyComponentConfig {
    // Define headingColor using standard palette access
    const headingColor = theme.palette.text.primary; // Adjusted
    const secondaryColor = theme.palette.text.secondary;

    // --- FIX: Define variant styles using the variants array ---
    const typographyVariants: ComponentsVariants['MuiTypography'] = [
        { props: { variant: 'h1' }, style: { color: headingColor } },
        { props: { variant: 'h2' }, style: { color: headingColor } },
        { props: { variant: 'h3' }, style: { color: headingColor } },
        { props: { variant: 'h4' }, style: { color: headingColor } },
        { props: { variant: 'h5' }, style: { color: headingColor } },
        { props: { variant: 'h6' }, style: { color: headingColor } },
        { props: { variant: 'subtitle1' }, style: { color: headingColor } }, // Adjusted
        { props: { variant: 'subtitle2' }, style: { color: secondaryColor } },
        { props: { variant: 'caption' }, style: { color: secondaryColor } },
        { props: { variant: 'body1' }, style: { color: theme.palette.text.primary } },
        { props: { variant: 'body2' }, style: { color: theme.palette.text.primary } }, // Adjusted
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