// packages/ui/src/pages/DashboardPage.tsx 
import React, { useState, useCallback } from "react";
import RGL, { WidthProvider } from "react-grid-layout";

// Import our actual widget components
import KpiCard from "../components/KpiCard";
import { CashFlowChart } from "../components/CashFlowChart";
import { InventoryHealthTable } from "../components/InventoryHealthTable";
import MDBox from "../components/MDBox";
import MDButton from "../components/MDButton";
import Icon from "@mui/material/Icon";

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

// Base layout definition, defined outside the component to prevent re-creation on re-renders
const initialLayout = [
  { i: "kpi-revenue", x: 0, y: 0, w: 3, h: 1 },
  { i: "kpi-margin", x: 3, y: 0, w: 3, h: 1 },
  { i: "kpi-inventory", x: 6, y: 0, w: 3, h: 1 },
  { i: "cashflow-chart", x: 0, y: 1, w: 9, h: 3 },
  { i: "inventory-health", x: 0, y: 4, w: 12, h: 4 },
];

export const DashboardPage = () => {
// State to manage the editing mode
const [isEditing, setIsEditing] = useState(false);
// State to hold the current layout of widgets
const [layout, setLayout] = useState(initialLayout);

// Callback to update the layout state when the user makes changes
  const onLayoutChange = useCallback((newLayout: RGL.Layout[]) => {
    // Only update layout state if in editing mode to prevent unwanted changes
    if (isEditing) {
      setLayout(newLayout);
    }
  }, [isEditing]);

  return (
    <>
      <MDBox display="flex" justifyContent="flex-end" mb={2}>
        {isEditing ? (
          <MDButton variant="gradient" color="success" onClick={() => setIsEditing(false)}>
            <Icon sx={{ marginRight: 1 }}>save</Icon>
            Done
          </MDButton>
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
      >
        <div key="kpi-revenue">
          <KpiCard title="Gross Revenue" value="$750,930" percentage="55%" icon="leaderboard" />
        </div>
        <div key="kpi-margin">
          <KpiCard title="Gross Margin" value="$320,400" percentage="12%" icon="store" />
        </div>
        <div key="kpi-inventory">
          <KpiCard title="Inventory Value" value="$1.2M" percentage="-2%" icon="inventory" />
        </div>
        <div key="cashflow-chart">
          <CashFlowChart data={mockCashFlowData}/>
        </div>
        <div key="inventory-health">
          <InventoryHealthTable />
        </div>
      </GridLayout>
    </>
  );
};