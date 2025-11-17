/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/palette.ts
import { ThemeOptions } from '@mui/material/styles'; // Import type
import { extendPaletteWithChannels, withAlpha } from 'utils/colorUtils'; // Ensure typed
// --- FIX: Import from presetColors.ts ---
import { getColorsById } from './presetColors';
// --- Remove SCSS imports ---
// import defaultColor from 'assets/scss/_themes-vars.module.scss';
// ... other theme scss imports ...

// Define Palette structure returned by buildPalette
interface BuiltPalette {
    light: ThemeOptions['palette']; // Use ThemeOptions['palette'] for structure
    dark: ThemeOptions['palette'];
}

// ==============================|| DEFAULT THEME - PALETTE ||============================== //

export function buildPalette(presetColorId: string): BuiltPalette { // Accept preset ID string
    // --- FIX: Get colors using the helper function ---
    const colors = getColorsById(presetColorId);

    // --- Build Light Palette ---
    const lightColors: ThemeOptions['palette'] = {
        mode: 'light', // Add mode
        primary: {
            light: colors.primaryLight, main: colors.primaryMain, dark: colors.primaryDark,
            contrastText: colors.paper, // Example contrast text
            // Add shades if needed by components
             '200': colors.primary200, '800': colors.primary800,
        },
        secondary: {
            light: colors.secondaryLight, main: colors.secondaryMain, dark: colors.secondaryDark,
            contrastText: colors.paper, // Example contrast text
             '200': colors.secondary200, '800': colors.secondary800,
        },
        error: { light: colors.errorLight, main: colors.errorMain, dark: colors.errorDark },
        orange: { light: colors.orangeLight, main: colors.orangeMain, dark: colors.orangeDark }, // Keep custom color
        warning: { light: colors.warningLight, main: colors.warningMain, dark: colors.warningDark, contrastText: colors.grey700 },
        success: { light: colors.successLight, main: colors.successMain, dark: colors.successDark, '200': colors.success200 },
        grey: { // Use standard grey keys
             '50': colors.grey50, '100': colors.grey100, '200': colors.grey200, '300': colors.grey300,
             // '400': ..., // Add if defined
             '500': colors.grey500, '600': colors.grey600, '700': colors.grey700,
             // '800': ..., // Add if defined
             '900': colors.grey900,
             // A100, A200, A400, A700 if needed
        },
        dark: { // Keep custom 'dark' palette color object for Berry components
             light: colors.darkTextPrimary, main: colors.darkLevel1, dark: colors.darkLevel2,
             '800': colors.darkBackground, '900': colors.darkPaper,
        },
        text: {
             primary: colors.grey700, secondary: colors.grey500, // Use standard text keys
             disabled: colors.grey300, // Example disabled text
             // hint: colors.grey100, // Hint is deprecated, use secondary or disabled
             // dark: colors.grey900, // Store in custom property if needed, not standard
             // heading: colors.grey900, // Store in custom property if needed
        },
        divider: colors.grey200,
        background: { paper: colors.paper, default: colors.grey50 },
        common: { black: colors.darkPaper, white: '#fff' }, // Add common colors
         action: { // Add action colors
             active: colors.grey600,
             hover: withAlpha(colors.grey900, 0.04), // Example hover
             selected: withAlpha(colors.grey900, 0.08), // Example selected
             disabled: withAlpha(colors.grey900, 0.26), // Example disabled text
             disabledBackground: withAlpha(colors.grey900, 0.12), // Example disabled background
             focus: withAlpha(colors.grey900, 0.12), // Example focus
         }
    };

    // --- Build Dark Palette ---
    const darkColors: ThemeOptions['palette'] = {
        mode: 'dark', // Add mode
        primary: {
            light: colors.darkPrimaryLight, main: colors.darkPrimaryMain, dark: colors.darkPrimaryDark,
            contrastText: colors.darkPaper,
             '200': colors.darkPrimary200, '800': colors.darkPrimary800,
        },
        secondary: {
            light: colors.darkSecondaryLight, main: colors.darkSecondaryMain, dark: colors.darkSecondaryDark,
            contrastText: colors.darkPaper,
             '200': colors.darkSecondary200, '800': colors.darkSecondary800,
        },
        error: { light: colors.errorLight, main: colors.errorMain, dark: colors.errorDark }, // Keep same? Adjust if needed
        orange: { light: colors.orangeLight, main: colors.orangeMain, dark: colors.orangeDark }, // Keep same?
        warning: { light: colors.warningLight, main: colors.warningMain, dark: colors.warningDark, contrastText: colors.darkPaper }, // Adjust contrast
        success: { light: colors.successLight, main: colors.successMain, dark: colors.successDark, '200': colors.success200 }, // Keep same?
        grey: { // Adjust grey shades for dark mode text/elements
             '50': colors.grey50, '100': colors.grey100, '200': colors.grey200, '300': colors.grey300,
             '500': colors.darkTextSecondary, '600': colors.darkTextTitle, '700': colors.darkTextPrimary,
             '900': colors.darkTextPrimary, // Adjust 900 if needed
        },
        dark: { // Keep custom dark object
             light: colors.darkTextPrimary, main: colors.darkLevel1, dark: colors.darkLevel2,
             '800': colors.darkBackground, '900': colors.darkPaper,
        },
        text: {
             primary: colors.darkTextPrimary, secondary: colors.darkTextSecondary,
             disabled: withAlpha(colors.darkTextPrimary, 0.5), // Example disabled dark text
             // dark: colors.darkTextPrimary, // Remove non-standard keys
             // heading: colors.darkTextTitle, // Remove non-standard keys
        },
        divider: withAlpha(colors.grey200, 0.2), // Use alpha for dark divider
        background: { paper: colors.darkLevel2, default: colors.darkPaper }, // Use dark bg colors
        common: { black: colors.darkPaper, white: '#fff' }, // Keep common
         action: { // Adjust action colors for dark mode
             active: colors.darkTextPrimary,
             hover: withAlpha(colors.darkTextPrimary, 0.08),
             selected: withAlpha(colors.darkTextPrimary, 0.16),
             disabled: withAlpha(colors.darkTextPrimary, 0.3),
             disabledBackground: withAlpha(colors.darkTextPrimary, 0.12),
             focus: withAlpha(colors.darkTextPrimary, 0.12),
         }
    };

    // --- Optional: Extend with Channels (if colorUtils function exists and is typed) ---
    // const extendedLight = extendPaletteWithChannels(lightColors);
    // const extendedDark = extendPaletteWithChannels(darkColors);
    // const extendedCommon = extendPaletteWithChannels(commonColor); // Common might not need channels

    return {
        // Return standard palette objects
        light: lightColors, // Use lightColors directly (or extendedLight if using channels)
        dark: darkColors, // Use darkColors directly (or extendedDark)
    };
}