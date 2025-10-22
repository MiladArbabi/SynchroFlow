/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/types/mui.d.ts
import '@mui/material/styles';
import '@mui/material/Chip';

import type {} from '@mui/x-data-grid/themeAugmentation';
import type {} from '@mui/x-date-pickers/themeAugmentation';
import type {} from '@mui/lab/themeAugmentation';

// Define the structure of the custom color objects Berry adds
interface CustomPaletteColor {
  light: string;
  main: string;
  dark: string;
  200?: string; // Optional shades based on palette.jsx
  800?: string; // Optional shades
  900?: string; // Optional shades
}

declare module '@mui/material/styles' {
  // Allow configuration using `createTheme`
  interface PaletteOptions {
    orange?: CustomPaletteColor;
    dark?: CustomPaletteColor; // Renaming to avoid conflict might be better, but match Berry for now
    MuiInternalDateTimePickerTabs?: { // Add this optional key
         styleOverrides?: any; // Use 'any' or try to find specific types
    };
  }

  // Allow usage like `theme.palette.orange.main`
  interface Palette {
    orange: CustomPaletteColor;
    dark: CustomPaletteColor; // Renaming to avoid conflict might be better, but match Berry for now
  }

  // Augment the Components interface to include MuiDataGrid and MuiDatePicker
  // The types are automatically pulled in by the themeAugmentation imports above
  interface Components<Theme = unknown> {
    MuiDataGrid?: {
      defaultProps?: ComponentsProps['MuiDataGrid'];
      styleOverrides?: ComponentsOverrides<Theme>['MuiDataGrid'];
      variants?: ComponentsVariants['MuiDataGrid'];
    };
    MuiDatePicker?: {
        // Adjust based on actual structure needed by DatePicker overrides
        defaultProps?: ComponentsProps['MuiDatePicker'];
        styleOverrides?: ComponentsOverrides<Theme>['MuiDatePicker'];
        variants?: ComponentsVariants['MuiDatePicker'];
    };
    MuiTimelineContent?: {
        defaultProps?: ComponentsProps['MuiTimelineContent'];
        styleOverrides?: ComponentsOverrides<Theme>['MuiTimelineContent'];
        variants?: ComponentsVariants['MuiTimelineContent'];
    };
    MuiTimelineDot?: {
        defaultProps?: ComponentsProps['MuiTimelineDot'];
        styleOverrides?: ComponentsOverrides<Theme>['MuiTimelineDot'];
        variants?: ComponentsVariants['MuiTimelineDot'];
    };
    MuiTreeItem?: {
            defaultProps?: ComponentsProps['MuiTreeItem'];
            styleOverrides?: ComponentsOverrides<Theme>['MuiTreeItem'];
            variants?: ComponentsVariants['MuiTreeItem'];
        };
  }
}

 //Optional: If specific components use these colors directly via 'color' prop
 declare module '@mui/material/Button' {
   interface ButtonPropsColorOverrides {
     orange: true;
     dark: true;
   }
 }
 declare module '@mui/material/Chip' {
   interface ChipPropsColorOverrides {
     orange: true;
     dark: true;
     light: true;
   }
   interface ChipPropsVariantOverrides {
     light: true;
   }
 }