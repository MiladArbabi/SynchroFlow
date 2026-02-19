/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/contexts/ConfigContext.tsx
import React, { createContext, useReducer } from 'react';
import config, { ConfigProps, ThemeDirection, ThemeMode } from '../config';

// Define action types
type ActionType =
  | { type: 'SET_MENU_ORIENTATION'; payload: ConfigProps['menuOrientation'] }
  | { type: 'SET_FONT_FAMILY'; payload: ConfigProps['fontFamily'] }
  | { type: 'SET_BORDER_RADIUS'; payload: ConfigProps['borderRadius'] }
  | { type: 'SET_OUTLINED_FILLED'; payload: ConfigProps['outlinedFilled'] }
  | { type: 'SET_CUSTOMIZATION_DRAWER'; payload: boolean }
  | { type: 'SET_PRESET_COLOR'; payload: ConfigProps['presetColor'] }
  | { type: 'SET_I18N'; payload: ConfigProps['i18n'] }
  | { type: 'SET_THEME_DIRECTION'; payload: ConfigProps['themeDirection'] }
  | { type: 'SET_CONTAINER'; payload: ConfigProps['container'] }
  | { type: 'TOGGLE_OPS_CONSOLE' }

// Define context state
export type ConfigContextState = {
  state: ConfigProps;
  dispatch: React.Dispatch<ActionType>;
};

// Create context
const ConfigContext = createContext<ConfigContextState>({
  state: config,
  dispatch: () => {}
});

// Reducer
const configReducer = (state: ConfigProps, action: ActionType): ConfigProps => {
  switch (action.type) {
    case 'SET_MENU_ORIENTATION':
      return { ...state, menuOrientation: action.payload };
    case 'SET_FONT_FAMILY':
      return { ...state, fontFamily: action.payload };
    case 'SET_BORDER_RADIUS':
      return { ...state, borderRadius: action.payload };
    case 'SET_OUTLINED_FILLED':
      return { ...state, outlinedFilled: action.payload };
    case 'SET_PRESET_COLOR':
      return { ...state, presetColor: action.payload };
    case 'SET_I18N':
      return { ...state, i18n: action.payload };
    case 'SET_THEME_DIRECTION':
      return { ...state, themeDirection: action.payload };
    case 'SET_CONTAINER':
      return { ...state, container: action.payload };
    case 'SET_CUSTOMIZATION_DRAWER':
     return { ...state, customizationDrawerOpen: action.payload };
    case 'TOGGLE_OPS_CONSOLE':
      return { ...state, isOpsConsoleOpen: !state.isOpsConsoleOpen };
    default:
      return state;
  }
};

// Provider
type ConfigProviderProps = {
  children: React.ReactNode;
};

function ConfigProvider({ children }: ConfigProviderProps) {
  const [state, dispatch] = useReducer(configReducer, config);

  return <ConfigContext.Provider value={{ state, dispatch }}>{children}</ConfigContext.Provider>;
}

export { ConfigProvider, ConfigContext };