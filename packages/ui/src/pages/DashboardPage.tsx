// packages/ui/src/pages/DashboardPage.tsx
import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';
import { ConnectStoreModal } from '../components/ConnectStoreModal';
import { KpiCard } from '../components/KpiCard';
import { InventoryHealthTable } from '../components/InventoryHealthTable';
import { FulfillmentPipelineChart } from '../components/FulfillmentPipelineChart';
//import Grid from "@mui/material/Grid"
import MDBox from '../components/MDBox';
import DashboardLayout from '../components/DashboardLayout';
import DashboardNavbar from "../components/DashboardNavbar";
import { PerfectOrderGauge } from '../components/PerfectOrderGauge';

const SandboxBanner: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <div className="rounded-md bg-blue-50 p-4 mb-8">
    <div className="flex">
      <div className="ml-3 flex-1 md:flex md:justify-between">
        <p className="text-sm text-blue-700">
          You are currently in a sandbox environment. Explore with sample data, or connect your own store to see real insights.
        </p>
        <p className="mt-3 text-sm md:ml-6 md:mt-0">
        <button onClick={onClick} className="whitespace-nowrap font-medium text-blue-700 hover:text-blue-600">            Connect Your Store &rarr;
          </button>
        </p>
      </div>
    </div>
  </div>
);

// This is a temporary functional component until we fix the layout issue.
const SimpleGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        {children}
    </div>
);

export function DashboardPage() {
  const { isSandbox } = useUser();

  // State for the modals
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox py={3}>
        {isSandbox && <SandboxBanner onClick={() => setIsConnectModalOpen(true)} />}
        
        <SimpleGrid>
          <KpiCard
            title="Gross Revenue"
            dataUrl="/api/v1/analytics/gross-revenue?shop_id=1"
            dataKey="gross_revenue"
            formatAs="currency"
            icon="leaderboard"
            color="dark"
          />
          <KpiCard
            title="Gross Margin"
            dataUrl="/api/v1/analytics/gross-margin?shop_id=1"
            dataKey="gross_margin_percentage"
            formatAs="percentage"
            icon="store"
            color="success"
          />
          <KpiCard
            title="Total Inventory Value"
            dataUrl="/api/v1/analytics/inventory-value?shop_id=1"
            dataKey="total_inventory_value"
            formatAs="currency"
            icon="paid"
            color="primary"
          />
          <KpiCard
            title="Cost of Stockout"
            dataUrl="/api/v1/analytics/cost-of-stockout?shop_id=1&sku=STOCKOUT-SKU-01"
            dataKey="cost_of_stockout"
            formatAs="currency"
            icon="warning"
            color="warning"
          />
        </SimpleGrid>

        <MDBox mt={4.5}>
          <SimpleGrid>
            <div style={{ gridColumn: 'span 2' }}><InventoryHealthTable /></div>
            <div><PerfectOrderGauge /></div>
            <div><FulfillmentPipelineChart /></div>
          </SimpleGrid>
        </MDBox>
      </MDBox>
      <ConnectStoreModal isOpen={isConnectModalOpen} onClose={() => setIsConnectModalOpen(false)} />
    </DashboardLayout>
  );
}