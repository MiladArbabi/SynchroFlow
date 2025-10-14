// packages/ui/src/contexts/MaterialUI.tsx
import React, { createContext, useContext, useReducer, ReactNode, useMemo } from "react";

// Define the shape of our context state and actions
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
// Define specific action types for a more robust reducer
type SetMiniSidenavAction = { type: "MINI_SIDENAV"; value: boolean };
type SetDarkModeAction = { type: "DARKMODE"; value: boolean };

// Combine them into a single discriminated union
type Action = SetMiniSidenavAction | SetDarkModeAction;

// Create the context
const MaterialUI = createContext<[State, React.Dispatch<Action>] | null>(null);

// Reducer function to handle state changes
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "MINI_SIDENAV": {
      return { ...state, miniSidenav: action.value };
    }
    case "DARKMODE": {
        return { ...state, darkMode: action.value };
    }
    // We can add other cases here as needed
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