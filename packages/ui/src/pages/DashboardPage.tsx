/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/DashboardPage.tsx 
import React, { useState, useCallback, useEffect } from "react";
import RGL, { WidthProvider } from "react-grid-layout";
import axios from "axios";

import MDBox from "../components/MDBox";
import MDButton from "../components/MDButton";
import Icon from "@mui/material/Icon";
import WidgetLibrary from "../components/WidgetLibrary";
import { WIDGET_REGISTRY } from "../widgets/widgetRegistry";
import { IconButton } from "@mui/material";
import { InventoryHealthTable, InventoryHealthRow } from "../components/InventoryHealthTable";

const GridLayout = WidthProvider(RGL);

// Mock data for the CashFlowChart component
const mockCashFlowData = [
  { name: 'Jan', cash: 4000 },
  { name: 'Feb', cash: 3000 },
  { name: 'Mar', cash: 5000 },
  { name: 'Apr', cash: 4500 },
  { name: 'May', cash: 6000 },
  { name: 'Jun', cash: 5500 },
];

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
  { instanceId: "cashflow-chart-1", widgetId: "cashflow-chart" },
  { instanceId: "inventory-health-1", widgetId: "inventory-health" },
];

// Defines the initial layout for those widgets
const initialLayout: RGL.Layout[] = [
  { i: "kpi-revenue-1", x: 0, y: 0, w: 3, h: 1 },
  { i: "kpi-margin-1", x: 3, y: 0, w: 3, h: 1 },
  { i: "kpi-inventory-1", x: 6, y: 0, w: 3, h: 1 },
  { i: "cashflow-chart-1", x: 0, y: 1, w: 9, h: 3 },
  { i: "inventory-health-1", x: 0, y: 4, w: 12, h: 4 },
];

const getWidgetProps = (widgetId: string) => {
  switch (widgetId) {
    case "kpi-revenue":
      return { title: "Gross Revenue", value: "$750,930", percentage: "55%", icon: "leaderboard" };
    case "kpi-margin":
      return { title: "Gross Margin", value: "$320,400", percentage: "12%", icon: "store" };
    case "kpi-inventory":
      return { title: "Inventory Value", value: "$1.2M", percentage: "-2%", icon: "inventory" };
    case "cashflow-chart":
      return { data: mockCashFlowData };
    case "inventory-health":
      return { data: mockInventoryHealthData };
    default:
      return {};
  }
};

export const DashboardPage = () => {
  // State to manage the editing mode
  const [isEditing, setIsEditing] = useState(false);
  // State to hold the current layout of widgets
  const [layout, setLayout] = useState(initialLayout);
  // State to hold the list of active widgets
  const [activeWidgets, setActiveWidgets] = useState(initialActiveWidgets);
  // State to manage the Widget Library visibility
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);

  // Callback to update the layout state when the user makes changes
  const onLayoutChange = useCallback((newLayout: RGL.Layout[]) => {
    // Only update layout state if in editing mode to prevent unwanted changes
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

  // Handler for adding a new widget from the library
  const handleAddWidget = (widgetId: string) => {
    console.log(`[DEBUG] handleAddWidget received: ${widgetId}`);
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
      },
    ]);
    // Explicitly close the library after adding a widget
    setIsLibraryOpen(false);
  };

// Handler for removing a widget from the dashboard
  const handleRemoveWidget = (instanceId: string) => {
    setActiveWidgets((prev) => prev.filter((w) => w.instanceId !== instanceId));
    setLayout((prev) => prev.filter((l) => l.i !== instanceId));
  };

  // Handler for saving the layout
  const handleSaveLayout = async () => {
    try {
      await axios.post("/api/v1/layouts/dashboard", {
        layout,
        activeWidgets,
      });
    } catch (error) {
      console.error("Failed to save layout:", error);
      // Optionally, show a snackbar/toast to the user that saving failed
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <>
      <MDBox display="flex" justifyContent="flex-end" mb={2}>
        {isEditing ? (
          <>
            <MDButton variant="gradient" color="info" onClick={() => setIsLibraryOpen(true)}>
              <Icon sx={{ marginRight: 1 }}>add</Icon>
              Add Widget
            </MDButton>
            <MDButton variant="gradient" color="success" onClick={handleSaveLayout}>
              <Icon sx={{ marginRight: 1 }}>save</Icon>
              Done
            </MDButton>
          </>
        ) : (
          <MDButton variant="outlined" color="info" onClick={() => setIsEditing(true)}>
            <Icon sx={{ marginRight: 1 }}>edit</Icon>
            Edit Layout
          </MDButton>
        )}
      </MDBox>

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
            // FIX: This wrapper div ensures each grid item has stable styling and a unique key.
            <div key={instanceId} style={{ width: '100%', height: '100%', position: 'relative' }}>
              <WidgetComponent {...getWidgetProps(widgetId)} />
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
                  <Icon fontSize="small">close</Icon>
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
      />
    </>
  );
};