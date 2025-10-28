/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/DashboardPage.tsx 
import React, { useState, useCallback, useEffect } from "react";
import RGL, { WidthProvider } from "react-grid-layout";
import axios from "axios";
import { useQuery } from '@tanstack/react-query'; // Import useQuery
import IconComponent from "../components/Icon";
import WidgetLibrary from "../components/WidgetLibrary";
import { PlanLevel, WIDGET_REGISTRY } from "../widgets/widgetRegistry";
import { IconButton, Box, CircularProgress, Alert } from "@mui/material"; // Added Box, CircularProgress, Alert
import { InventoryHealthRow } from "widgets/InventoryHealthWidget";
import { useLayoutContext } from "../App";
import { ConnectStoreModal } from "../components/ConnectStoreModal";
import { ConnectStoreBanner } from "../components/ConnectStoreBanner";

const GridLayout = WidthProvider(RGL);

// --- OpsIntelData type ---
interface OpsIntelData {
  automated_tasks: number;
  labor_cost_saved: number;
}

// Defines the API response structure (matching the backend service)
interface OpsIntelSummaryResponse extends OpsIntelData {}

// Mock data for the InventoryHealthTable component
const mockInventoryHealthData: InventoryHealthRow[] = [
  { sku: 'SF-TS-BLK-M', quantity_available: 150, status: 'Healthy' },
  { sku: 'SF-HD-GRY-L', quantity_available: 25, status: 'At Risk' },
  { sku: 'SF-CP-NAV-OS', quantity_available: 0, status: 'Stockout' },
  { sku: 'SF-TS-WHT-S', quantity_available: 80, status: 'Healthy' },
];

// Defines the widgets that are active on the dashboard by default
const initialActiveWidgets = [
  { instanceId: "kpi-revenue-1", widgetId: "kpi-revenue" },
  { instanceId: "kpi-margin-1", widgetId: "kpi-margin" },
  { instanceId: "kpi-inventory-1", widgetId: "kpi-inventory" },
  { instanceId: "a-opex-gauge-1", widgetId: "a-opex-gauge" },
  { instanceId: "cashflow-chart-1", widgetId: "cashflow-chart" },
  { instanceId: "inventory-health-1", widgetId: "inventory-health" },
];

// Defines the initial layout for those widgets
const initialLayout: RGL.Layout[] = [
  { i: "kpi-revenue-1", x: 0, y: 0, w: 3, h: 1 },
  { i: "kpi-margin-1", x: 3, y: 0, w: 3, h: 1 },
  { i: "kpi-inventory-1", x: 6, y: 0, w: 3, h: 1 },
  { i: "a-opex-gauge-1", x: 9, y: 0, w: 3, h: 2 },
  { i: "cashflow-chart-1", x: 0, y: 1, w: 6, h: 4 },
  { i: "inventory-health-1", x: 0, y: 4, w: 6, h: 4 },
];

const getWidgetProps = (
  widgetId: string, 
  opsIntelData: OpsIntelData | undefined
) => {
  switch (widgetId) {
    case "kpi-revenue":
      return { title: "Gross Revenue", value: "$750,930", percentage: "55%", icon: "BarChart3" }; 
    case "kpi-margin":
      return { title: "Gross Margin", value: "$320,400", percentage: "12%", icon: "Store" };
    case "kpi-inventory":
      return { title: "Inventory Value", value: "$1.2M", percentage: "-2%", icon: "Package" };
    case "a-opex-gauge":
      return { 
        title: "Opex Saved", 
        value: opsIntelData?.labor_cost_saved ?? 0,
        target: 10000 // Hardcode target for v1
      };
    case "cashflow-chart":
      return {};
    case "inventory-health":
      return { data: mockInventoryHealthData };
    default:
      return {};
  }
};

export const DashboardPage = () => {
  const [layout, setLayout] = useState(initialLayout);
  const [activeWidgets, setActiveWidgets] = useState(initialActiveWidgets);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [showConnectBanner, setShowConnectBanner] = useState(false);

  const fetchOpsIntel = async (): Promise<OpsIntelSummaryResponse> => {
    const { data } = await axios.get<OpsIntelSummaryResponse>("/api/v1/ops-intel/summary");
    return data;
  };

  const {
    data: opsIntelData, // Renamed from opsIntelSummaryData for consistency
    isLoading: opsIntelLoading, // Use isLoading from useQuery
    isError: opsIntelIsError, // Use isError from useQuery
    error: opsIntelError, // Use error from useQuery
  } = useQuery<OpsIntelSummaryResponse, Error>({
    queryKey: ['opsIntelSummary'], // Unique key for this query
    queryFn: fetchOpsIntel,
    // Optional: Add staleTime if this data doesn't change often
    // staleTime: 5 * 60 * 1000, // 5 minutes
  });

    // Get editing state and library controls from parent context
  const {
    isEditing,
    isLibraryOpen,
    setIsLibraryOpen,
    currentUserPlan,
    layoutRef, // Get refs from context
    activeWidgetsRef, // Get refs from context
  } = useLayoutContext();

  // Callback to update the layout state when the user makes changes
  const onLayoutChange = useCallback((newLayout: RGL.Layout[]) => {
    if (isEditing) {
      setLayout(newLayout);
    }
  }, [isEditing]);

  // Fetch the saved layout when the component mounts
  useEffect(() => {
    const fetchLayout = async () => {
      try {
        const response = await axios.get("/api/v1/layouts/dashboard");
        if (response.data) {
          setLayout(response.data.layout);
          setActiveWidgets(response.data.activeWidgets);
        }
      } catch (error) {
        // If a 404 occurs, it means no layout is saved yet. We can ignore this.
        console.log("No saved layout found, using default.");
        setShowConnectBanner(true);
      }
    };
    fetchLayout();
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- HANDLE MODAL CLOSE ---
  // When the modal closes (especially on success), we'll reload 
  // the page to fetch the new dashboard layout and data.
  const handleModalClose = () => {
    setIsConnectModalOpen(false); // Close the modal
    setShowConnectBanner(false); // Hide the banner on success
    // Simple reload to refresh all data.
    window.location.reload(); 
  };

  // Handler for adding a new widget from the library
  const handleAddWidget = (widgetId: string) => {
    const widgetConfig = WIDGET_REGISTRY[widgetId];
    if (!widgetConfig) return;

    const newInstanceId = `${widgetId}-${Date.now()}`;

    setActiveWidgets((prev) => [...prev, { instanceId: newInstanceId, widgetId }]);
    setLayout((prev) => [
      ...prev,
      {
        i: newInstanceId,
        x: 0, // New widgets appear at the top-left
        y: 0,
        ...widgetConfig.defaultLayout,
        static: false,
      },
    ]);
  };

// Handler for removing a widget from the dashboard
  const handleRemoveWidget = (instanceId: string) => {
    setActiveWidgets((prev) => prev.filter((w) => w.instanceId !== instanceId));
    setLayout((prev) => prev.filter((l) => l.i !== instanceId));
  };

  // --- Display loading/error state for OpsIntel data ---
  if (opsIntelLoading) {
     // Or return a more integrated loading state within the GridLayout
     return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><CircularProgress /></Box>;
  }
  if (opsIntelIsError) {
      // Or display the error more gracefully within the dashboard layout
      return <Box sx={{ p: 2 }}><Alert severity="error">Failed to load dashboard data: {opsIntelError?.message}</Alert></Box>;
  }
  // --- End Optional Loading/Error Display ---

  return (
    <>
    {/* --- 5. RENDER BANNER & MODAL --- */}
      {showConnectBanner && (
        <ConnectStoreBanner onOpenModal={() => setIsConnectModalOpen(true)} />
      )}
      <ConnectStoreModal
        isOpen={isConnectModalOpen}
        onClose={handleModalClose} 
      />

      <GridLayout
        layout={layout}
        cols={12}
        rowHeight={120}
        compactType={null}
        preventCollision={true}
        isDraggable={isEditing}
        isResizable={isEditing}
        onLayoutChange={onLayoutChange}
        // Add a class for styling the grid items in edit mode
        className={isEditing ? "grid-editing" : ""}
      >
      {activeWidgets.map(({ instanceId, widgetId }) => {
          const WidgetComponent = WIDGET_REGISTRY[widgetId]?.component; // Add safe navigation
          if (!WidgetComponent) {
              console.warn(`Widget component for ID "${widgetId}" not found.`);
              return <div key={instanceId}>Error: Widget not found</div>; // Render fallback
            }
          return (
            <div key={instanceId} style={{ width: '100%', height: '100%', position: 'relative' }}>
              {/* Pass the data fetched by useQuery */}
              <WidgetComponent {...getWidgetProps(widgetId, opsIntelData)} />
              {isEditing && (
                <IconButton
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => handleRemoveWidget(instanceId)}
                  size="small"
                  sx={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    backgroundColor: "rgba(255, 255, 255, 0.7)",
                    "&:hover": { backgroundColor: "white" },
                    zIndex: 10,
                  }}
                >
                  <IconComponent name="X" size="xs" color="inherit"/>
                </IconButton>
              )}
            </div>
          );
        })}
      </GridLayout>
     <WidgetLibrary
        open={isLibraryOpen} 
        onClose={() => setIsLibraryOpen(false)}
        onAddWidget={handleAddWidget}
        currentPlan={currentUserPlan}
      />
    </>
  );
};