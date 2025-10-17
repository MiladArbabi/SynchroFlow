// packages/ui/src/pages/DashboardPage.tsx
import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';
import { ConnectStoreModal } from '../components/ConnectStoreModal';
import { KpiCard } from '../components/KpiCard';
import { InventoryHealthTable } from '../components/InventoryHealthTable';
import { FulfillmentPipelineChart } from '../components/FulfillmentPipelineChart';
import { PerfectOrderGauge } from '../components/PerfectOrderGauge';
import  Grid from '@mui/material/Grid';
import MDBox from '../components/MDBox';

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

export function DashboardPage() {
  const { isSandbox } = useUser();
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  return (
    <MDBox py={3}>
      {isSandbox && <SandboxBanner onClick={() => setIsConnectModalOpen(true)} />}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <MDBox mb={1.5}>
            <KpiCard
              title="Gross Revenue"
              dataUrl="/api/v1/analytics/gross-revenue?shop_id=1"
              dataKey="gross_revenue"
              formatAs="currency"
              icon="leaderboard"
              color="dark"
            />
          </MDBox>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <MDBox mb={1.5}>
            <KpiCard
              title="Gross Margin"
              dataUrl="/api/v1/analytics/gross-margin?shop_id=1"
              dataKey="gross_margin_percentage"
              formatAs="percentage"
              icon="store"
              color="success"
            />
          </MDBox>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <MDBox mb={1.5}>
            <KpiCard
              title="Total Inventory Value"
              dataUrl="/api/v1/analytics/inventory-value?shop_id=1"
              dataKey="total_inventory_value"
              formatAs="currency"
              icon="paid"
              color="primary"
            />
          </MDBox>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <MDBox mb={1.5}>
            <KpiCard
              title="Cost of Stockout"
              dataUrl="/api/v1/analytics/cost-of-stockout?shop_id=1&sku=STOCKOUT-SKU-01"
              dataKey="cost_of_stockout"
              formatAs="currency"
              icon="warning"
              color="warning"
            />
          </MDBox>
        </Grid>
      </Grid>
      <MDBox mt={4.5}>
         <Grid container spacing={3}>
         <Grid size={{ xs: 12, md: 7 }}>
            <InventoryHealthTable />
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
             <MDBox mb={3}>
              <PerfectOrderGauge />
            </MDBox>
             <FulfillmentPipelineChart />
           </Grid>
         </Grid>
       </MDBox>
      <ConnectStoreModal isOpen={isConnectModalOpen} onClose={() => setIsConnectModalOpen(false)} />
    </MDBox>
  );
}