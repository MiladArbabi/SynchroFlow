// packages/ui/src/pages/DashboardPage.tsx
import RGL, { WidthProvider } from "react-grid-layout";

// Import our actual widget components
import KpiCard from "../components/KpiCard";
import { CashFlowChart } from "../components/CashFlowChart";
import { InventoryHealthTable } from "../components/InventoryHealthTable";

const GridLayout = WidthProvider(RGL);

export const DashboardPage = () => {
  // This layout defines the initial position and size of our real widgets
  const layout = [
    { i: "kpi-revenue", x: 0, y: 0, w: 3, h: 1 },
    { i: "kpi-margin", x: 3, y: 0, w: 3, h: 1 },
    { i: "kpi-inventory", x: 6, y: 0, w: 3, h: 1 },
    { i: "cashflow-chart", x: 0, y: 1, w: 9, h: 3 },
    { i: "inventory-health", x: 0, y: 4, w: 12, h: 4 },
  ];

  return (
    <GridLayout
      layout={layout}
      cols={12}
      rowHeight={120} // Adjusted for better vertical spacing
      compactType={null}
      preventCollision={true}
    >
      <div key="kpi-revenue">
        <KpiCard title="Gross Revenue" value="$750,930" percentage="+55%" icon="leaderboard" />
      </div>
      <div key="kpi-margin">
        <KpiCard title="Gross Margin" value="$320,400" percentage="+12%" icon="store" />
      </div>
      <div key="kpi-inventory">
        <KpiCard title="Inventory Value" value="$1.2M" percentage="-2%" icon="inventory" />
      </div>
      <div key="cashflow-chart">
        <CashFlowChart />
      </div>
      <div key="inventory-health">
        <InventoryHealthTable />
      </div>
    </GridLayout>
  );
};