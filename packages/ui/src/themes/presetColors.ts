// packages/ui/src/themes/presetColors.ts

// Define the structure for a color set
interface ColorSet {
  id: string; // Identifier ('default', 'theme1', etc.)
  // Swatch colors (used directly by PresetColor component)
  primary: string; // Light mode primary main
  secondary: string; // Light mode secondary main
  primaryDarkSwatch: string; // Dark mode primary main (renamed for clarity)
  secondaryDarkSwatch: string; // Dark mode secondary main (renamed for clarity)
  // Actual theme colors (used by palette builder)
  primaryLight: string;
  primaryMain: string;
  primaryDark: string;
  primary200: string;
  primary800: string;
  secondaryLight: string;
  secondaryMain: string;
  secondaryDark: string;
  secondary200: string;
  secondary800: string;
  // Dark theme colors
  darkPrimaryLight: string;
  darkPrimaryMain: string;
  darkPrimaryDark: string;
  darkPrimary200: string;
  darkPrimary800: string;
  darkSecondaryLight: string;
  darkSecondaryMain: string;
  darkSecondaryDark: string;
  darkSecondary200: string;
  darkSecondary800: string;
}

// Default Colors (from _themes-vars.module.scss)
const defaultColors: ColorSet = {
  id: 'default',
  primary: '#2196f3', primaryDarkSwatch: '#2196f3',
  secondary: '#673ab7', secondaryDarkSwatch: '#7c4dff',
  primaryLight: '#e3f2fd', primaryMain: '#2196f3', primaryDark: '#1e88e5', primary200: '#90caf9', primary800: '#1565c0',
  secondaryLight: '#ede7f6', secondaryMain: '#673ab7', secondaryDark: '#5e35b1', secondary200: '#b39ddb', secondary800: '#4527a0',
  darkPrimaryLight: '#e3f2fd', darkPrimaryMain: '#2196f3', darkPrimaryDark: '#1e88e5', darkPrimary200: '#90caf9', darkPrimary800: '#1565c0',
  darkSecondaryLight: '#d1c4e9', darkSecondaryMain: '#7c4dff', darkSecondaryDark: '#651fff', darkSecondary200: '#b39ddb', darkSecondary800: '#6200ea',
};

// Theme 1 Colors (from _theme1.module.scss)
const theme1Colors: ColorSet = {
  id: 'theme1',
  primary: '#607d8b', primaryDarkSwatch: '#78919c',
  secondary: '#009688', secondaryDarkSwatch: '#009688',
  primaryLight: '#eceff1', primaryMain: '#607d8b', primaryDark: '#546e7a', primary200: '#b0bec5', primary800: '#455a64',
  secondaryLight: '#e0f2f1', secondaryMain: '#009688', secondaryDark: '#00897b', secondary200: '#80cbc4', secondary800: '#00695c',
  darkPrimaryLight: '#eceff1', darkPrimaryMain: '#78919c', darkPrimaryDark: '#587583', darkPrimary200: '#b0bec5', darkPrimary800: '#44606e',
  darkSecondaryLight: '#e0f2f1', darkSecondaryMain: '#009688', darkSecondaryDark: '#00897b', darkSecondary200: '#80cbc4', darkSecondary800: '#00695c',
};

// Theme 2 Colors (from _theme2.module.scss)
const theme2Colors: ColorSet = {
  id: 'theme2',
  primary: '#203461', primaryDarkSwatch: '#606d88',
  secondary: '#ec407a', secondaryDarkSwatch: '#ec407a',
  primaryLight: '#e4e7ec', primaryMain: '#203461', primaryDark: '#1c2f59', primary200: '#909ab0', primary800: '#132145',
  secondaryLight: '#fde8ef', secondaryMain: '#ec407a', secondaryDark: '#ea3a72', secondary200: '#f6a0bd', secondary800: '#e42a5d',
  darkPrimaryLight: '#ecedf1', darkPrimaryMain: '#606d88', darkPrimaryDark: '#586580', darkPrimary200: '#b0b6c4', darkPrimary800: '#44506b',
  darkSecondaryLight: '#fde8ef', darkSecondaryMain: '#ec407a', darkSecondaryDark: '#ea3a72', darkSecondary200: '#f6a0bd', darkSecondary800: '#e42a5d',
};

// Theme 3 Colors (from _theme3.module.scss)
const theme3Colors: ColorSet = {
  id: 'theme3',
  primary: '#16595a', primaryDarkSwatch: '#1f7778',
  secondary: '#c77e23', secondaryDarkSwatch: '#c77e23',
  primaryLight: '#e3ebeb', primaryMain: '#16595a', primaryDark: '#135152', primary200: '#8bacad', primary800: '#0c3e3f',
  secondaryLight: '#f8f0e5', secondaryMain: '#c77e23', secondaryDark: '#c1761f', secondary200: '#e3bf91', secondary800: '#b36115',
  darkPrimaryLight: '#eceff1', darkPrimaryMain: '#1f7778', darkPrimaryDark: '#1b6f70', darkPrimary200: '#8fbbbc', darkPrimary800: '#125a5b',
  darkSecondaryLight: '#f8f0e5', darkSecondaryMain: '#c77e23', darkSecondaryDark: '#c1761f', darkSecondary200: '#e3bf91', darkSecondary800: '#b36115',
};

// Theme 4 Colors (from _theme4.module.scss)
const theme4Colors: ColorSet = {
  id: 'theme4',
  primary: '#173e43', primaryDarkSwatch: '#3a5b5f',
  secondary: '#3fb0ac', secondaryDarkSwatch: '#3fb0ac',
  primaryLight: '#e3e8e8', primaryMain: '#173e43', primaryDark: '#14383d', primary200: '#8b9fa1', primary800: '#0d282c',
  secondaryLight: '#e8f6f5', secondaryMain: '#3fb0ac', secondaryDark: '#39a9a5', secondary200: '#9fd8d6', secondary800: '#299792',
  darkPrimaryLight: '#e3e8e8', darkPrimaryMain: '#3a5b5f', darkPrimaryDark: '#14383d', darkPrimary200: '#8b9fa1', darkPrimary800: '#0d282c',
  darkSecondaryLight: '#e8f6f5', darkSecondaryMain: '#3fb0ac', darkSecondaryDark: '#39a9a5', darkSecondary200: '#9fd8d6', darkSecondary800: '#299792',
};

// Theme 5 Colors (from _theme5.module.scss)
const theme5Colors: ColorSet = {
  id: 'theme5',
  primary: '#0a2342', primaryDarkSwatch: '#54657b',
  secondary: '#2ca58d', secondaryDarkSwatch: '#2ca58d',
  primaryLight: '#e2e5e8', primaryMain: '#0a2342', primaryDark: '#091f3c', primary200: '#8591a1', primary800: '#05152b',
  secondaryLight: '#e6f4f1', secondaryMain: '#2ca58d', secondaryDark: '#279d85', secondary200: '#96d2c6', secondary800: '#1b8a70',
  darkPrimaryLight: '#e2e5e8', darkPrimaryMain: '#54657b', darkPrimaryDark: '#2f445e', darkPrimary200: '#8591a1', darkPrimary800: '#05152b',
  darkSecondaryLight: '#e6f4f1', darkSecondaryMain: '#2ca58d', darkSecondaryDark: '#279d85', darkSecondary200: '#96d2c6', darkSecondary800: '#1b8a70',
};

// Theme 6 Colors (from _theme6.module.scss)
const theme6Colors: ColorSet = {
  id: 'theme6',
  primary: '#3f51b5', primaryDarkSwatch: '#7267ef', // Note: Theme6 Dark Primary is different
  secondary: '#3f51b5', secondaryDarkSwatch: '#7267ef', // Note: Theme6 Dark Secondary is different
  primaryLight: '#e8eaf6', primaryMain: '#3f51b5', primaryDark: '#3949ab', primary200: '#9fa8da', primary800: '#283593',
  secondaryLight: '#e8eaf6', secondaryMain: '#3f51b5', secondaryDark: '#3949ab', secondary200: '#9fa8da', secondary800: '#283593',
  darkPrimaryLight: '#eeedfd', darkPrimaryMain: '#7267ef', darkPrimaryDark: '#6a5fed', darkPrimary200: '#b9b3f7', darkPrimary800: '#554ae8',
  darkSecondaryLight: '#eeedfd', darkSecondaryMain: '#7267ef', darkSecondaryDark: '#6a5fed', darkSecondary200: '#b9b3f7', darkSecondary800: '#554ae8',
};

// Base colors (usually consistent across presets) - Copied from _themes-vars
export const baseColors = {
    paper: '#ffffff',
    errorLight: '#ef9a9a', errorMain: '#f44336', errorDark: '#c62828',
    orangeLight: '#fbe9e7', orangeMain: '#ffab91', orangeDark: '#d84315',
    warningLight: '#fff8e1', warningMain: '#ffe57f', warningDark: '#ffc107',
    successLight: '#b9f6ca', success200: '#69f0ae', successMain: '#00e676', successDark: '#00c853',
    grey50: '#f8fafc', grey100: '#eef2f6', grey200: '#e3e8ef', grey300: '#cdd5df',
    grey500: '#697586', grey600: '#4b5565', grey700: '#364152', grey900: '#121926',
    darkBackground: '#1a223f', darkPaper: '#111936', darkLevel1: '#29314f', darkLevel2: '#212946',
    darkTextTitle: '#d7dcec', darkTextPrimary: '#bdc8f0', darkTextSecondary: '#8492c4',
};

// Exported list of available presets
export const presetColorOptions: ColorSet[] = [
    defaultColors,
    theme1Colors,
    theme2Colors,
    theme3Colors,
    theme4Colors,
    theme5Colors,
    theme6Colors,
];

// Export a function to get colors by ID (used by palette builder)
// Merges found preset colors with base colors (preset overrides base)
export const getColorsById = (id: string): Partial<ColorSet> & typeof baseColors => {
  const found = presetColorOptions.find(p => p.id === id);
  return { ...baseColors, ...(found || defaultColors) };
};