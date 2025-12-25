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
import ModuleBootstrap from 'runtime/ModuleBootstrap';
import { RuntimeRoutesProvider } from "runtime/RuntimeRoutesProvider";
import { useRuntimeRoutes } from 'runtime/useRuntimeRoutes';

import OrdersPage from "pages/OrdersPage";
import CustomersPage from "pages/CustomersPage";
import ProductsPage from "pages/ProductsPage";

// --- BERRY THEME IMPORT ---
import ThemeCustomization from './themes';
import FinancesPage from "pages/FinancesPage";
import AnalyticsPage from "pages/AnalyticsPage";
import { ConnectStoreModal } from "components/ConnectStoreModal";

import { DashboardPage } from "pages/DashboardPage";
import { ModuleLifecycleShell } from "lifecycle/ModuleLifecycleShell";
import LoginPage from "pages/authentication/LoginPage";
import RegisterPage from "pages/authentication/RegisterPage";
import { DashboardLifecycleShell } from "lifecycle/DashboardLifecycleShell";
import { ShopLifecycleShell } from "lifecycle/ShopLifecycleShell";
import { ShopLifecycleGate } from "lifecycle/ShopLifecycleGate";

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
  const [isConnectModalOpen, setIsConnectModalOpen] = React.useState(false);

  const handleConnectStoreIntent = React.useCallback(() => {
    console.log('[App] ui:connect-store received');
    setIsConnectModalOpen(true);
  }, []);

  React.useEffect(() => {
    window.addEventListener('ui:connect-store', handleConnectStoreIntent);
    return () => {
      window.removeEventListener('ui:connect-store', handleConnectStoreIntent);
    };
  }, [handleConnectStoreIntent]);

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

                  <ConnectStoreModal
                    isOpen={isConnectModalOpen}
                    onClose={() => setIsConnectModalOpen(false)}
                  />
                  
                  <IntlErrorBoundary>
                  <Routes>
                    {/* ---------------- Public auth routes ---------------- */}
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />

                    {/* ---------------- Protected SaaS app ---------------- */}
                    <Route element={<ProtectedRoute />}>
                      {/* 🔑 Layout ALWAYS mounted */}
                      <Route element={<LayoutManager />}>
                       {/* 1️⃣ Shop lifecycle state */}
                        <Route
                          element={
                            <ShopLifecycleShell>
                              <ShopLifecycleGate />
                            </ShopLifecycleShell>
                          }
                        >
                          {/* 2️⃣ REAL app routes — EXIST ONLY AT FT1 */}
                          {/* Dashboard */}
                          <Route
                            path="/dashboard"
                            element={
                              <DashboardLifecycleShell
                                onActivate={() =>
                                  window.dispatchEvent(
                                    new Event('ui:connect-store')
                                  )
                                }
                              >
                                <DashboardPage handleSidenavToggle={() => {}} />
                              </DashboardLifecycleShell>
                            }
                          />

                          {/* Orders */}
                          <Route
                            path="/orders/*"
                            element={
                              <ModuleLifecycleShell moduleId="order-nexus">
                                <OrdersPage />
                              </ModuleLifecycleShell>
                            }
                          />

                          {/* Customers */}
                          <Route
                            path="/customers/*"
                            element={
                              <ModuleLifecycleShell moduleId="customers">
                                <CustomersPage />
                              </ModuleLifecycleShell>
                            }
                          />

                          {/* Products */}
                          <Route
                            path="/products/*"
                            element={
                              <ModuleLifecycleShell moduleId="products">
                                <ProductsPage />
                              </ModuleLifecycleShell>
                            }
                          />

                          {/* Analytics */}
                          <Route
                            path="/analytics/*"
                            element={
                              <ModuleLifecycleShell moduleId="analytics">
                                <AnalyticsPage />
                              </ModuleLifecycleShell>
                            }
                          />

                          {/* Finances */}
                          <Route
                            path="/finances/*"
                            element={
                              <ModuleLifecycleShell moduleId="finances">
                                <FinancesPage />
                              </ModuleLifecycleShell>
                            }
                          />

                          {/* Dynamic modules */}
                          <Route path="modules/:moduleId/*" />
                        </Route>
                      </Route>
                    </Route>

                    {/* ---------------- Root & fallback ---------------- */}
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
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