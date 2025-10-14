import React, { createContext, useContext, useReducer, ReactNode, useMemo } from "react";

// Define the shape of our context state
interface State {
  miniSidenav: boolean;
  transparentSidenav: boolean;
  whiteSidenav: boolean;
  sidenavColor: "info" | "success" | "warning" | "error" | "dark";
  transparentNavbar: boolean;
  fixedNavbar: boolean;
  openConfigurator: boolean;
  direction: "ltr" | "rtl";
  layout: "dashboard" | "page";
  darkMode: boolean;
}

// Define all possible action types for a fully robust reducer
type Action =
  | { type: "MINI_SIDENAV"; value: boolean }
  | { type: "TRANSPARENT_SIDENAV"; value: boolean }
  | { type: "WHITE_SIDENAV"; value: boolean }
  | { type: "SIDENAV_COLOR"; value: State['sidenavColor'] }
  | { type: "TRANSPARENT_NAVBAR"; value: boolean }
  | { type: "FIXED_NAVBAR"; value: boolean }
  | { type: "OPEN_CONFIGURATOR"; value: boolean }
  | { type: "DIRECTION"; value: "ltr" | "rtl" }
  | { type: "LAYOUT"; value: "dashboard" | "page" }
  | { type: "DARKMODE"; value: boolean };

// Create the context
const MaterialUI = createContext<[State, React.Dispatch<Action>] | null>(null);

// Reducer function to handle all state changes
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "MINI_SIDENAV": return { ...state, miniSidenav: action.value };
    case "TRANSPARENT_SIDENAV": return { ...state, transparentSidenav: action.value };
    case "WHITE_SIDENAV": return { ...state, whiteSidenav: action.value };
    case "SIDENAV_COLOR": return { ...state, sidenavColor: action.value };
    case "TRANSPARENT_NAVBAR": return { ...state, transparentNavbar: action.value };
    case "FIXED_NAVBAR": return { ...state, fixedNavbar: action.value };
    case "OPEN_CONFIGURATOR": return { ...state, openConfigurator: action.value };
    case "DIRECTION": return { ...state, direction: action.value };
    case "LAYOUT": return { ...state, layout: action.value };
    case "DARKMODE": return { ...state, darkMode: action.value };
    default: {
      throw new Error(`Unhandled action type: ${(action as { type: string }).type}`);
    }
  }
}

// The provider component
export const MaterialUIControllerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const initialState: State = {
    miniSidenav: false,
    transparentSidenav: false,
    whiteSidenav: false,
    sidenavColor: "info",
    transparentNavbar: true,
    fixedNavbar: true,
    openConfigurator: false,
    direction: "ltr",
    layout: "dashboard",
    darkMode: false,
  };

  const [controller, dispatch] = useReducer(reducer, initialState);
  const value = useMemo<[State, React.Dispatch<Action>]>(() => [controller, dispatch], [controller, dispatch]);

  return <MaterialUI.Provider value={value}>{children}</MaterialUI.Provider>;
}

// Custom hook to use the context
// eslint-disable-next-line react-refresh/only-export-components
export function useMaterialUIController(): [State, React.Dispatch<Action>] {
  const context = useContext(MaterialUI);
  if (!context) {
    throw new Error("useMaterialUIController should be used inside the MaterialUIControllerProvider.");
  }
  return context;
}

// Helper functions to dispatch actions, making them easy to use
/* eslint-disable react-refresh/only-export-components */
export const setMiniSidenav = (dispatch: React.Dispatch<Action>, value: boolean) => dispatch({ type: "MINI_SIDENAV", value });
export const setTransparentSidenav = (dispatch: React.Dispatch<Action>, value: boolean) => dispatch({ type: "TRANSPARENT_SIDENAV", value });
export const setWhiteSidenav = (dispatch: React.Dispatch<Action>, value: boolean) => dispatch({ type: "WHITE_SIDENAV", value });
export const setSidenavColor = (dispatch: React.Dispatch<Action>, value: State['sidenavColor']) => dispatch({ type: "SIDENAV_COLOR", value });
export const setTransparentNavbar = (dispatch: React.Dispatch<Action>, value: boolean) => dispatch({ type: "TRANSPARENT_NAVBAR", value });
export const setFixedNavbar = (dispatch: React.Dispatch<Action>, value: boolean) => dispatch({ type: "FIXED_NAVBAR", value });
export const setOpenConfigurator = (dispatch: React.Dispatch<Action>, value: boolean) => dispatch({ type: "OPEN_CONFIGURATOR", value });
export const setDirection = (dispatch: React.Dispatch<Action>, value: "ltr" | "rtl") => dispatch({ type: "DIRECTION", value });
export const setLayout = (dispatch: React.Dispatch<Action>, value: "dashboard" | "page") => dispatch({ type: "LAYOUT", value });
export const setDarkMode = (dispatch: React.Dispatch<Action>, value: boolean) => dispatch({ type: "DARKMODE", value });
/* eslint-enable react-refresh/only-export-components */