// apps/frontend/src/themes/presetColors.ts

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

const defaultColors: ColorSet = {
 id: 'default',
 primary: '#2563EB', primaryDarkSwatch: '#2563EB', // Blue-600 (SSOT)
 secondary: '#64748B', secondaryDarkSwatch: '#64748B', // Slate-500
 primaryLight: '#DBEAFE', primaryMain: '#2563EB', primaryDark: '#1D4ED8', primary200: '#BFDBFE', primary800: '#1E40AF',
 secondaryLight: '#E2E8F0', secondaryMain: '#64748B', secondaryDark: '#475569', secondary200: '#CBD5E1', secondary800: '#1E293B',
 darkPrimaryLight: '#DBEAFE', darkPrimaryMain: '#2563EB', darkPrimaryDark: '#1D4ED8', darkPrimary200: '#BFDBFE', darkPrimary800: '#1E40AF',
 darkSecondaryLight: '#E2E8F0', darkSecondaryMain: '#64748B', darkSecondaryDark: '#475569', darkSecondary200: '#CBD5E1', darkSecondary800: '#1E293B',
};

// Mono Light Colors
const monoLightColors: ColorSet = {
  id: 'mono_light',
  primary: '#424242', primaryDarkSwatch: '#616161',
  secondary: '#757575', secondaryDarkSwatch: '#9e9e9e',
  primaryLight: '#ececec', primaryMain: '#424242', primaryDark: '#343434', primary200: '#a0a0a0', primary800: '#212121',
  secondaryLight: '#f0f0f0', secondaryMain: '#757575', secondaryDark: '#616161', secondary200: '#bdbdbd', secondary800: '#424242',
  darkPrimaryLight: '#e0e0e0', darkPrimaryMain: '#616161', darkPrimaryDark: '#424242', darkPrimary200: '#9e9e9e', darkPrimary800: '#212121',
  darkSecondaryLight: '#eeeeee', darkSecondaryMain: '#9e9e9e', darkSecondaryDark: '#757575', darkSecondary200: '#bdbdbd', darkSecondary800: '#424242',
};

// Mono Dark Colors
const monoDarkColors: ColorSet = {
  id: 'mono_dark',
  primary: '#bdbdbd', primaryDarkSwatch: '#eeeeee',
  secondary: '#808080', secondaryDarkSwatch: '#aaaaaa',
  primaryLight: '#ffffff', primaryMain: '#bdbdbd', primaryDark: '#a0a0a0', primary200: '#eeeeee', primary800: '#757575',
  secondaryLight: '#f5f5f5', secondaryMain: '#808080', secondaryDark: '#6a6a6a', secondary200: '#b3b3b3', secondary800: '#4d4d4d',
  darkPrimaryLight: '#ffffff', darkPrimaryMain: '#eeeeee', darkPrimaryDark: '#bdbdbd', darkPrimary200: '#f5f5f5', darkPrimary800: '#9e9e9e',
  darkSecondaryLight: '#dddddd', darkSecondaryMain: '#aaaaaa', darkSecondaryDark: '#888888', darkSecondary200: '#cccccc', darkSecondary800: '#666666',
};

// Orange Colors
const orangeColors: ColorSet = {
  id: 'orange',
  primary: '#FF9800', primaryDarkSwatch: '#EF6C00',
  secondary: '#FFC107', secondaryDarkSwatch: '#FFA000',
  primaryLight: '#FFF3E0', primaryMain: '#FF9800', primaryDark: '#FB8C00', primary200: '#FFE082', primary800: '#EF6C00',
  secondaryLight: '#FFF8E1', secondaryMain: '#FFC107', secondaryDark: '#FFB300', secondary200: '#FFECB3', secondary800: '#FFA000',
  darkPrimaryLight: '#FFF3E0', darkPrimaryMain: '#EF6C00', darkPrimaryDark: '#E65100', darkPrimary200: '#FFE082', darkPrimary800: '#D84315',
  darkSecondaryLight: '#FFF8E1', darkSecondaryMain: '#FFA000', darkSecondaryDark: '#F57C00', darkSecondary200: '#FFECB3', darkSecondary800: '#EF6C00',
};

// Green Olive Colors
const greenOliveColors: ColorSet = {
  id: 'green_olive',
  primary: '#8bc34a', primaryDarkSwatch: '#add580',
  secondary: '#7a8c6a', secondaryDarkSwatch: '#afbaa5',
  primaryLight: '#e7f3da', primaryMain: '#8bc34a', primaryDark: '#7daf42', primary200: '#b9db92', primary800: '#374e1d',
  secondaryLight: '#e4e8e1', secondaryMain: '#7a8c6a', secondaryDark: '#6d7e5f', secondary200: '#afbaa5', secondary800: '#30382a',
  darkPrimaryLight: '#e7f3da', darkPrimaryMain: '#add580', darkPrimaryDark: '#7daf42', darkPrimary200: '#b9db92', darkPrimary800: '#374e1d',
  darkSecondaryLight: '#e4e8e1', darkSecondaryMain: '#afbaa5', darkSecondaryDark: '#6d7e5f', darkSecondary200: '#afbaa5', darkSecondary800: '#30382a',
};

// Lavender Violet Colors
const lavenderVioletColors: ColorSet = {
  id: 'lavender_violet',
  primary: '#6a4c7c', primaryDarkSwatch: '#a593b0',
  secondary: '#d7c4e2', secondaryDarkSwatch: '#e1dbe4',
  primaryLight: '#e1dbe4', primaryMain: '#6a4c7c', primaryDark: '#5f446f', primary200: '#a593b0', primary800: '#2a1e31',
  secondaryLight: '#f5f2f7', secondaryMain: '#d7c4e2', secondaryDark: '#c2b1cd', secondary200: '#e5d7ed', secondary800: '#564f5a',
  darkPrimaryLight: '#e1dbe4', darkPrimaryMain: '#a593b0', darkPrimaryDark: '#5f446f', darkPrimary200: '#a593b0', darkPrimary800: '#2a1e31',
  darkSecondaryLight: '#f5f2f7', darkSecondaryMain: '#e1dbe4', darkSecondaryDark: '#c2b1cd', darkSecondary200: '#e5d7ed', darkSecondary800: '#564f5a',
};

// Brown Beige Colors
const brownBeigeColors: ColorSet = {
  id: 'brown_beige',
  primary: '#8d6e63', primaryDarkSwatch: '#baa8a1',
  secondary: '#a1887f', secondaryDarkSwatch: '#c6b7b2',
  primaryLight: '#e8e2df', primaryMain: '#8d6e63', primaryDark: '#7e6359', primary200: '#baa8a1', primary800: '#382c27',
  secondaryLight: '#ece7e5', secondaryMain: '#a1887f', secondaryDark: '#907a72', secondary200: '#c6b7b2', secondary800: '#403632',
  darkPrimaryLight: '#e8e2df', darkPrimaryMain: '#baa8a1', darkPrimaryDark: '#7e6359', darkPrimary200: '#baa8a1', darkPrimary800: '#382c27',
  darkSecondaryLight: '#ece7e5', darkSecondaryMain: '#c6b7b2', darkSecondaryDark: '#907a72', darkSecondary200: '#c6b7b2', darkSecondary800: '#403632',
};

// Base colors (usually consistent across presets)
// Replaced error, warning, and success with our new SSOT 'emotional' colors.
export const baseColors = {
  paper: '#ffffff',
  // --- SSOT 'emotional' colors ---
  errorLight: '#FECACA', errorMain: '#DC2626', errorDark: '#991B1B', // urgent (Red-400, 600, 800)
  orangeLight: '#fff8e1', orangeMain: '#ffecb3', orangeDark: '#fb8c00', // Kept for now, as it's not semantic
  warningLight: '#FDE68A', warningMain: '#D97706', warningDark: '#92400E', // concerned (Amber-300, 600, 800)
  successLight: '#A7F3D0', success200: '#6EE7B7', successMain: '#059669', successDark: '#065F46', // celebratory (Emerald-300, 400, 600, 800)
    // --- SSOT 'ui' colors ---
  grey50: '#F8FAFC', grey100: '#F1F5F9', grey200: '#E2E8F0', grey300: '#CBD5E1', // Slate-50, 100, 200, 300
  grey500: '#64748B', grey600: '#475569', grey700: '#334155', grey900: '#0F172A', // Slate-500, 600, 700, 900
    // --- SSOT 'text' colors ---
  darkBackground: '#0F172A', // Slate-900
    darkPaper: '#0F172A',      // Slate-900 (Page BG)
    darkLevel1: '#475569',      // Slate-600 (Widget Hover/Variant)
    darkLevel2: '#334155',      // Slate-700 (Widget BG)
    darkTextTitle: '#F8FAFC', // Slate-50 (was #ffffff)
    darkTextPrimary: '#E2E8F0', // Slate-200 (was #e5e5e7)
    darkTextSecondary: '#94A3B8', // Slate-400 (was #a5adbb)
};

// Exported list of available presets
export const presetColorOptions: ColorSet[] = [
    defaultColors,
    monoLightColors,
    monoDarkColors,
    orangeColors,
    greenOliveColors,
    lavenderVioletColors,
    brownBeigeColors,
];

// Export a function to get colors by ID (used by palette builder)
// Merges found preset colors with base colors (preset overrides base)
export const getColorsById = (id: string): Partial<ColorSet> & typeof baseColors => {
  const found = presetColorOptions.find(p => p.id === id);
  return { ...baseColors, ...(found || defaultColors) };
};