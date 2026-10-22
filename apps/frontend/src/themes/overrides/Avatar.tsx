/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/themes/overrides/Avatar.tsx
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { AvatarClassKey, AvatarProps } from '@mui/material/Avatar';

// Define the component override object structure for merging
type AvatarComponentConfig = Components<Theme>['MuiAvatar'];

// ==============================|| OVERRIDES - AVATAR ||============================== //

export default function Avatar(_theme: Theme): AvatarComponentConfig {
    return {
        styleOverrides: {
            root: {
                // Define CSS variables for default colors using standard palette
                // Light Mode Defaults
                // Token-driven so both colour schemes resolve (themes/tokens.ts)
                '--avatar-default-color': 'var(--accent-text)',
                '--avatar-default-bg': 'var(--accent-ghost)',

                // Use the variables
                color: 'var(--avatar-default-color)',
                backgroundColor: 'var(--avatar-default-bg)',
                fontWeight: 500, // Example: Add default font weight
            },
            // Add overrides for specific variants if needed
            // rounded: {
            //     borderRadius: theme.shape.borderRadius, // Use theme border radius
            // },
            // colorDefault: { // Styles specifically for when no color prop is set
            //     color: 'var(--avatar-default-color)',
            //     backgroundColor: 'var(--avatar-default-bg)'
            // }
        }
    };
}