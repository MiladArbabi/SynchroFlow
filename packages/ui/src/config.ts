// packages/ui/src/config.ts
export const DASHBOARD_PATH = '/sample-page';
export const HORIZONTAL_MAX_ITEM = 7;
export const CSS_VAR_PREFIX = '';

export enum MenuOrientation {
  VERTICAL = 'vertical',
  HORIZONTAL = 'horizontal'
}

export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system'
}

export enum ThemeDirection {
  LTR = 'ltr',
  RTL = 'rtl'
}

export enum AuthProvider {
  JWT = 'jwt',
  FIREBASE = 'firebase',
  AUTH0 = 'auth0',
  AWS = 'aws',
  SUPABASE = 'supabase'
}

export enum DropzopType {
  DEFAULT = 'DEFAULT',
  STANDARD = 'STANDARD'
}

export const APP_AUTH = AuthProvider.JWT;
export const DEFAULT_THEME_MODE = ThemeMode.SYSTEM;

// Config state definition
export type ConfigProps = {
  menuOrientation: MenuOrientation;
  miniDrawer: boolean;
  fontFamily: string;
  borderRadius: number;
  outlinedFilled: boolean;
  presetColor: string;
  i18n: string;
  themeDirection: ThemeDirection;
  container: boolean;
};

const config: ConfigProps = {
  menuOrientation: MenuOrientation.VERTICAL,
  miniDrawer: false,
  fontFamily: `'Roboto', sans-serif`,
  borderRadius: 8,
  outlinedFilled: true,
  presetColor: 'default',
  i18n: 'en',
  themeDirection: ThemeDirection.LTR,
  container: true,
};

export default config;
export const drawerWidth = 260; 
export const gridSpacing = 3;