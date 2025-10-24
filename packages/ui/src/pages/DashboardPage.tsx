/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/DashboardPage.tsx 
import React, { useState, useCallback, useEffect } from "react";
import RGL, { WidthProvider } from "react-grid-layout";
import axios from "axios";
import IconComponent from "../components/Icon";
import WidgetLibrary from "../components/WidgetLibrary";
import { PlanLevel, WIDGET_REGISTRY } from "../widgets/widgetRegistry";
import { IconButton } from "@mui/material";
import { InventoryHealthRow } from "widgets/InventoryHealthWidget";
import { useLayoutContext } from "../App";

const GridLayout = WidthProvider(RGL);

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

// Define Ops-Intel data type ---
interface OpsIntelData {
  automated_tasks: number;
  labor_cost_saved: number;
}

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
  opsIntelData: OpsIntelData // Pass in the new data
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
        value: opsIntelData.labor_cost_saved, 
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
  // State to hold the current layout of widgets
  const [layout, setLayout] = useState(initialLayout);
  // State to hold the list of active widgets
  const [activeWidgets, setActiveWidgets] = useState(initialActiveWidgets);
  const [opsIntelData, setOpsIntelData] = useState<OpsIntelData>({ 
    automated_tasks: 0, 
    labor_cost_saved: 0 
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

  // Keep refs updated whenever local state changes
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout, layoutRef]);

  useEffect(() => {
    activeWidgetsRef.current = activeWidgets;
  }, [activeWidgets, activeWidgetsRef]);

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
      }
    };
    fetchLayout();
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- FETCH OPS-INTEL DATA ---
  useEffect(() => {
    const fetchOpsIntel = async () => {
      try {
        // This is the call our Red Test is looking for
        const response = await axios.get("/api/v1/ops-intel/summary");
        setOpsIntelData(response.data);
      } catch (error) {
        console.error("Failed to fetch Ops-Intel data:", error);
      }
    };
    fetchOpsIntel();
  }, []);

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

  return (
    <>
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
        const WidgetComponent = WIDGET_REGISTRY[widgetId].component;
        return (
          <div key={instanceId} style={{ width: '100%', height: '100%', position: 'relative' }}>
            <WidgetComponent {...getWidgetProps(widgetId, opsIntelData)} />
              {isEditing && (
                <IconButton
                  // FIX: Stop propagation to prevent the grid from capturing the click.
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