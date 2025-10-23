/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/contexts/ConfigContext.tsx
import React, { createContext, useReducer } from 'react';
import config, { ConfigProps, ThemeDirection, ThemeMode } from '/Users/miladarbabi/Codes/projects/SynchroFlow/packages/ui/src/config.ts'; // Import our new TS config

// Define action types
type ActionType =
  | { type: 'SET_MENU_ORIENTATION'; payload: ConfigProps['menuOrientation'] }
  | { type: 'SET_MINI_DRAWER'; payload: ConfigProps['miniDrawer'] }
  | { type: 'SET_FONT_FAMILY'; payload: ConfigProps['fontFamily'] }
  | { type: 'SET_BORDER_RADIUS'; payload: ConfigProps['borderRadius'] }
  | { type: 'SET_OUTLINED_FILLED'; payload: ConfigProps['outlinedFilled'] }
  | { type: 'SET_PRESET_COLOR'; payload: ConfigProps['presetColor'] }
  | { type: 'SET_I18N'; payload: ConfigProps['i18n'] }
  | { type: 'SET_THEME_DIRECTION'; payload: ConfigProps['themeDirection'] }
  | { type: 'SET_CONTAINER'; payload: ConfigProps['container'] };

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
  console.log('[DEBUG-ConfigContext] Action Received:', action); // Log every action
  switch (action.type) {
    case 'SET_MENU_ORIENTATION':
      return { ...state, menuOrientation: action.payload };
    case 'SET_MINI_DRAWER':
      return { ...state, miniDrawer: action.payload };
    case 'SET_FONT_FAMILY':
      return { ...state, fontFamily: action.payload };
    case 'SET_BORDER_RADIUS':
      return { ...state, borderRadius: action.payload };
    case 'SET_OUTLINED_FILLED':
      return { ...state, outlinedFilled: action.payload };
    case 'SET_PRESET_COLOR':
      console.log(`[DEBUG-ConfigContext] Updating presetColor from ${state.presetColor} to ${action.payload}`);
      return { ...state, presetColor: action.payload };
    case 'SET_I18N':
      return { ...state, i18n: action.payload };
    case 'SET_THEME_DIRECTION':
      return { ...state, themeDirection: action.payload };
    case 'SET_CONTAINER':
      return { ...state, container: action.payload };
    default:
      console.log('[DEBUG-ConfigContext]  Reducer: No state change for action', action);
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