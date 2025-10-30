/* eslint-disable react-refresh/only-export-components */
// packages/ui/src/App.tsx
import React from "react";
import axios from "axios";
import RGL from 'react-grid-layout'
import { Routes, Route, Navigate, Outlet, useOutletContext } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import Customization from "./layout/Customization";
import routes from "./routes";
import { PlanLevel } from "./widgets/widgetRegistry";

// --- BERRY THEME IMPORT ---
import ThemeCustomization from './themes';
// --- END BERRY IMPORT ---

// --- REMOVED OLD THEME ---
// import { ThemeProvider } from "@mui/material/styles";
// import CssBaseline from "@mui/material/CssBaseline";
// import { createTheme } from "@mui/material/styles";
// const spikeTheme = createTheme();
// import { UserProvider } from "./contexts/UserContext"; // This is now in main.tsx
// --- END REMOVED ---


// Define the type for the context passed via Outlet
type LayoutContextType = {
  isEditing: boolean;
  isLibraryOpen: boolean;
  setIsLibraryOpen: (open: boolean) => void;
  currentUserPlan: PlanLevel;
  layoutRef: React.MutableRefObject<RGL.Layout[]>;
  activeWidgetsRef: React.MutableRefObject<{ instanceId: string; widgetId: string }[]>;
  handleSaveLayout: () => Promise<void>;
};

// Custom hook to easily access the layout context
export function useLayoutContext() {
  return useOutletContext<LayoutContextType>();
}

// Helper Component to manage layout state and render AppLayout
const LayoutManager = () => {
  // State for managing layout editing mode
  const [isEditing, setIsEditing] = React.useState(false);
  // State for managing the Widget Library visibility
  const [isLibraryOpen, setIsLibraryOpen] = React.useState(false);
  // Mock user plan for WidgetLibrary gating
  const currentUserPlan: PlanLevel = 'Ignition';
  const layoutRef = React.useRef<RGL.Layout[]>([]);
  const activeWidgetsRef = React.useRef<{ instanceId: string; widgetId: string }[]>([]);

  // Handler for saving the layout (calls backend)
  const handleSaveLayout = async () => {
    try {
      await axios.post("/api/v1/layouts/dashboard", {
        layout: layoutRef.current, // Use data from refs
        activeWidgets: activeWidgetsRef.current,
      });
    } catch (error) {
      console.error("Failed to save layout:", error);
      // Optionally, show a snackbar/toast to the user that saving failed
    } finally {
      setIsEditing(false); // Toggle editing state AFTER save attempt
    }
  };

  const contextValue: LayoutContextType = {
    isEditing,
    isLibraryOpen,
    setIsLibraryOpen,
    currentUserPlan,
    layoutRef,
    activeWidgetsRef,
    handleSaveLayout,
  };

  return (
    <AppLayout
      isEditing={isEditing}
      onEditToggle={isEditing ? handleSaveLayout : () => setIsEditing(true)}
      onAddWidget={() => setIsLibraryOpen(true)}
    >
      {/* Pass state down via Outlet context */}
      <Outlet context={contextValue} />
    </AppLayout>
  );
};

export default function App() {
  return (
    // Wrap the entire app in Berry's ThemeCustomization
    // This reads from ConfigProvider and provides the MUI theme + CssBaseline
    <ThemeCustomization>
      <Routes>
        {/* Render the sign-in route standalone */}
        {routes
          .filter((route) => route.key === 'login' || route.key === 'register') // Filter for auth keys
          .map((route) => (
             <Route path={route.route} element={route.component} key={route.key} />
        ))}

        {/* All other routes are nested inside the AppLayout */}
        {/* --- WRAP LAYOUT MANAGER WITH PROTECTED ROUTE --- */}
        <Route element={<ProtectedRoute />}>
          <Route element={<LayoutManager />}>
          {routes
            .filter((route) => route.key !== 'login' && route.key !== 'register') // Filter OUT auth keys
            .map((route) => (
              <Route path={route.route} element={route.component} key={route.key} />
            ))}
          </Route>
        </Route>

        {/* A default redirect to the dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
      <Customization />
    </ThemeCustomization>
  );
}