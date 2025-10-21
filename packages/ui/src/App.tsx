/* eslint-disable react-refresh/only-export-components */
// packages/ui/src/App.tsx
import React from "react";
import { Routes, Route, Navigate, Outlet, useOutletContext } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppLayout from "./layouts/AppLayout";
import routes from "./routes";
import { UserProvider } from "./contexts/UserContext";
import { PlanLevel } from "./widgets/widgetRegistry";

import { createTheme } from "@mui/material/styles";
const spikeTheme = createTheme();

// Define the type for the context passed via Outlet
type LayoutContextType = {
  isEditing: boolean;
  isLibraryOpen: boolean;
  setIsLibraryOpen: (open: boolean) => void;
  currentUserPlan: PlanLevel;
};

// Custom hook to easily access the layout context
export function useLayoutContext() {
  return useOutletContext<LayoutContextType>();
}

// Helper Component to manage layout state and render AppLayout
const LayoutManager = () => {
  //const location = useLocation(); // Needed for breadcrumbs eventually

  // State for managing layout editing mode
  const [isEditing, setIsEditing] = React.useState(false);
  // State for managing the Widget Library visibility
  const [isLibraryOpen, setIsLibraryOpen] = React.useState(false);
  // Mock user plan for WidgetLibrary gating
  const currentUserPlan: PlanLevel = 'Ignition';

  // Placeholder for Sidenav toggle logic
  const handleToggleSidenav = () => {
    console.log("Sidenav toggle clicked");
  };

  const contextValue: LayoutContextType = {
   isEditing,
   isLibraryOpen,
   setIsLibraryOpen,
   currentUserPlan,
 };

  return (
    <AppLayout
      isEditing={isEditing}
      onEditToggle={() => setIsEditing(!isEditing)}
      onAddWidget={() => setIsLibraryOpen(true)}
      onToggleSidenav={handleToggleSidenav}
    >
      {/* Pass state down via Outlet context */}
     <Outlet context={contextValue} />
    </AppLayout>
  );
};

export default function App() {
  return (
    <UserProvider>
      <ThemeProvider theme={spikeTheme}>
        <CssBaseline />
        <Routes>
        {/* Render the sign-in route standalone */}
          <Route path="/authentication/sign-in" element={routes.find(r => r.key === 'sign-in')?.component} />
          {/* All other routes are nested inside the AppLayout */}
          <Route element={<LayoutManager />}>
            {routes.map((route) =>
              route.key !== "sign-in" ? (
                <Route path={route.route} element={route.component} key={route.key} />
              ) : null
            )}
          </Route>

          {/* A default redirect to the dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </ThemeProvider>
    </UserProvider>
  );
}