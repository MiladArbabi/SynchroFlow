/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/Avatar.tsx
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { AvatarClassKey, AvatarProps } from '@mui/material/Avatar';

// Define the component override object structure for merging
type AvatarComponentConfig = Components<Theme>['MuiAvatar'];

// ==============================|| OVERRIDES - AVATAR ||============================== //

export default function Avatar(theme: Theme): AvatarComponentConfig {
    return {
        styleOverrides: {
            root: {
                // Define CSS variables for default colors using standard palette
                // Light Mode Defaults
                '--avatar-default-color': theme.palette.primary.dark || '#1e88e5',
                '--avatar-default-bg': theme.palette.primary[200] || '#90caf9',

                // Apply dark mode variables directly using theme mode check
                ...(theme.palette.mode === 'dark' && {
                    '--avatar-default-color': theme.palette.dark?.main || '#212946', // Use augmented dark color or fallback
                    '--avatar-default-bg': theme.palette.text.primary || '#bdc8f0'
                }),

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