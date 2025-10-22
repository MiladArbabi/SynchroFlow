// packages/ui/src/types/mui.d.ts
import '@mui/material/styles';

// Define the structure of the custom color objects Berry adds
interface CustomPaletteColor {
  light: string;
  main: string;
  dark: string;
  200?: string; // Optional shades based on palette.jsx
  800?: string; // Optional shades
  900?: string; // Optional shades
}

// Extend the Palette and PaletteOptions interfaces
declare module '@mui/material/styles' {
  // Allow configuration using `createTheme`
  interface PaletteOptions {
    orange?: CustomPaletteColor;
    dark?: CustomPaletteColor; // Renaming to avoid conflict might be better, but match Berry for now
  }

  // Allow usage like `theme.palette.orange.main`
  interface Palette {
    orange: CustomPaletteColor;
    dark: CustomPaletteColor; // Renaming to avoid conflict might be better, but match Berry for now
  }
}

// Optional: If specific components use these colors directly via 'color' prop
// declare module '@mui/material/Button' {
//   interface ButtonPropsColorOverrides {
//     orange: true;
//     dark: true;
//   }
// }
// declare module '@mui/material/Chip' {
//   interface ChipPropsColorOverrides {
//     orange: true;
//     dark: true;
//   }
// }
// Add similar overrides for other components if needed