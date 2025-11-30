// apps/frontend/src/ui-component/extended/Avatar.tsx
import React, { forwardRef } from 'react';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import MuiAvatar, { AvatarProps as MuiAvatarProps } from '@mui/material/Avatar'; // Alias MuiAvatar
import { SxProps } from '@mui/system';


// Define custom props for outline, color, size
export type AvatarVariant = 'rounded' | 'square' | 'circular'; // Standard variants
export type AvatarSize = 'badge' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'; // Custom sizes
export type AvatarColor =
   | 'primary' | 'secondary' | 'error' | 'warning' | 'success' | 'info'
   | 'default' | undefined; // Standard colors + default

// Extend MuiAvatarProps, adding custom props and omitting potentially conflicting ones
export interface AvatarProps extends Omit<MuiAvatarProps, 'variant' | 'color'> {
  color?: AvatarColor;
  outline?: boolean;
  size?: AvatarSize;
  variant?: AvatarVariant; // Use standard MUI variant names
  // Add other custom props if needed
}

// ==============================|| CUSTOM AVATAR ||============================== //

const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
   (
        {
            color = 'primary', // Default color
            outline = false,
            size = 'md', // Default size
            variant = 'circular', // Default variant
            sx,
            children,
            ...otherProps // Spread remaining MuiAvatarProps
        },
        ref
    ) => {
    const theme = useTheme();

    // --- Size Styles ---
    let sizeSx: SxProps<Theme> = {};
    switch (size) {
        case 'badge': sizeSx = { width: 28, height: 28 }; break;
        case 'xs': sizeSx = { width: 34, height: 34 }; break;
        case 'sm': sizeSx = { width: 40, height: 40 }; break;
        case 'lg': sizeSx = { width: 72, height: 72 }; break;
        case 'xl': sizeSx = { width: 84, height: 84 }; break;
        case 'md': default: sizeSx = { width: 50, height: 50 }; break; // Default md size
    }

    // --- Color Styles ---
    let colorSx: SxProps<Theme> = {};
    const paletteColor = color && color !== 'default' ? theme.palette[color] : undefined;

    if (paletteColor) {
        if (outline) {
             // Outline styles
             colorSx = {
                 color: paletteColor.main,
                 bgcolor: 'transparent', // Transparent background
                 border: '2px solid', // Use solid border
                 borderColor: paletteColor.main,
             };
        } else {
            // Filled styles
            colorSx = {
                 color: paletteColor.light, // Text color often light for contrast
                 bgcolor: paletteColor.main, // Background is main color
            };
        }
         // Adjust text color for specific palettes if needed (e.g., warning)
         if (color === 'warning') {
             colorSx.color = theme.palette.common.black; // Ensure contrast
         }
    } else {
         // Default color styles (if color='default' or undefined)
         if (outline) {
             colorSx = {
                 color: theme.palette.text.primary,
                 bgcolor: 'transparent',
                 border: '2px solid',
                 borderColor: theme.palette.divider, // Use divider color for default outline
             };
         } else {
              // Use theme's default Avatar background/text or define explicitly
              colorSx = {
                 color: theme.palette.mode === 'dark' ? theme.palette.dark?.main : theme.palette.primary.dark,
                 bgcolor: theme.palette.mode === 'dark' ? theme.palette.text.primary : theme.palette.primary[200],
              }
         }
    }


    // --- Variant Style ---
    // MuiAvatar handles variant directly, but we can add overrides if needed
    // let variantSx: SxProps<Theme> = {};
    // if (variant === 'rounded') variantSx.borderRadius = `${theme.shape.borderRadius}px`;
    // else if (variant === 'square') variantSx.borderRadius = 0;

    return (
      <MuiAvatar
        ref={ref}
        variant={variant} // Pass standard variant prop
        sx={{
            ...colorSx,
            ...sizeSx,
            //...variantSx,
            ...sx // Allow user sx to override
        }}
        {...otherProps} // Pass remaining props
      >
        {children}
      </MuiAvatar>
    );
  }
);

export default Avatar;