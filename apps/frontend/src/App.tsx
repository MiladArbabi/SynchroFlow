/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/
import React from "react";
import { axiosInstance } from "api/axiosConfig";
import RGL from 'react-grid-layout'
import { Routes, Route, Navigate, Outlet, useOutletContext } from "react-router-dom";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntegrationProvider } from 'contexts/IntegrationContext';
import { DashboardStateProvider } from "contexts/DashboardStateContext";
import { EntitlementsProvider } from 'contexts/EntitlementsContext';
import { SpecterConfigProvider } from "contexts/SpecterConfigContext";

import AppLayout from "./layouts/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import ModuleHost from "runtime/ModuleHost";
import routes from "./routes";
import ModuleBootstrap from 'runtime/ModuleBootstrap';
import { getRegisteredRoutes } from 'runtime/registerRoute';
import { RuntimeRoutesProvider } from "runtime/RuntimeRoutesProvider";
import { useRuntimeRoutes } from 'runtime/useRuntimeRoutes';

// --- BERRY THEME IMPORT ---
import ThemeCustomization from './themes';

// Define the type for the context passed via Outlet
type LayoutContextType = {
  isEditing: boolean;
  isLibraryOpen: boolean;
  setIsLibraryOpen: (open: boolean) => void;
  layoutRef: React.MutableRefObject<RGL.Layout[]>;
  activeWidgetsRef: React.MutableRefObject<{ instanceId: string; widgetId: string }[]>;
  handleSaveLayout: () => Promise<void>;
};

// Custom hook to easily access the layout context
export function useLayoutContext() {
  return useOutletContext<LayoutContextType>();
}

const queryClient = new QueryClient();

// Helper Component to manage layout state and render AppLayout
const LayoutManager = () => {
  // State for managing layout editing mode
  const [isEditing, setIsEditing] = React.useState(false);
  // State for managing the Widget Library visibility
  const [isLibraryOpen, setIsLibraryOpen] = React.useState(false);
  // Mock user plan for WidgetLibrary gating
  const layoutRef = React.useRef<RGL.Layout[]>([]);
  const activeWidgetsRef = React.useRef<{ instanceId: string; widgetId: string }[]>([]);

  // Handler for saving the layout (calls backend)
  const handleSaveLayout = async () => {
    try {
      await axiosInstance.post("/api/v1/layouts/dashboard", {
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

function RuntimeRoutesSubscriber() {
  // This hook ONLY forces rerender when routes change
  // We intentionally ignore the value
  useRuntimeRoutes();
  return null;
}

class IntlErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any) {
    console.error('[IntlErrorBoundary] Caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <h2>UI rendering error</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  /* const { version } = useRuntimeRoutes(); */

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeRoutesProvider>
        <RuntimeRoutesSubscriber />

        <DashboardStateProvider>
          <IntegrationProvider>
            <ThemeCustomization>
              <EntitlementsProvider>
                <SpecterConfigProvider>
                  <ModuleBootstrap />
                   <IntlErrorBoundary>
                    <Routes>
                      {/* Public auth routes */}
                      {routes
                        .filter(
                          (route) =>
                            route.key === 'login' || route.key === 'register'
                        )
                        .map((route) => {
                          const Component = route.component;
                          return (
                            <Route
                              key={route.key}
                              path={route.route}
                              element={Component ? <Component /> : null}
                            />
                          );
                        })}
                      {/* Protected SaaS app */}
                    <Route element={<ProtectedRoute />}>
                      <Route element={<LayoutManager />}>
                        {/* Runtime-registered routes */}
                          {getRegisteredRoutes()
                            .filter(r => r.path && r.key !== 'login' && r.key !== 'register')
                            .map(route => {
                              const Component = route.component;
                              return (
                                <Route
                                  key={route.id}
                                  path={route.path}
                                  element={Component ? <Component /> : null}
                                />
                              );
                            })}

                          {/* 🔗 STATIC BRIDGE for Orders (required for refresh / deep links) */}
                          <Route
                            path="/orders/*"
                            element={<ModuleHost />}
                          />
                          {/* 🔗 STATIC BRIDGE for Customers */}
                          <Route
                            path="/customers/*"
                            element={<ModuleHost />}
                          />
                          {/* 🔗 STATIC BRIDGE for Products */}
                          <Route
                            path="/products/*"
                            element={<ModuleHost />}
                          />
                          {/* Dynamic modules */}
                        <Route path="modules/:moduleId/*" element={<ModuleHost />} />
                      </Route>
                    </Route>

                    {/* Root */}
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                  </IntlErrorBoundary>
                </SpecterConfigProvider>
              </EntitlementsProvider>
            </ThemeCustomization>
          </IntegrationProvider>
        </DashboardStateProvider>
      </RuntimeRoutesProvider>
    </QueryClientProvider>
  );
}