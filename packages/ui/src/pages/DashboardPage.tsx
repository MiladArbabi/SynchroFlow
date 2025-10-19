// packages/ui/src/pages/DashboardPage.tsx
import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';
import { ConnectStoreModal } from '../components/ConnectStoreModal';
import KpiCard from '../components/KpiCard';
import { InventoryHealthTable } from '../components/InventoryHealthTable';
import { FulfillmentPipelineChart } from '../components/FulfillmentPipelineChart';
import { PerfectOrderGauge } from '../components/PerfectOrderGauge';
import  Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MDBox from '../components/MDBox';

const SandboxBanner: React.FC<{ onClick: () => void }> = ({ onClick }) => (
 <Box sx={{ p: 2, mb: 3, backgroundColor: 'primary.lighter', borderRadius: 1, border: '1px solid', borderColor: 'primary.light', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <Typography variant="body2" sx={{ color: 'primary.dark' }}>
      You are currently in a sandbox environment. Explore with sample data, or connect your own store to see real insights.
    </Typography>
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: 'inherit' }}>
      Connect Your Store &rarr;
    </button>
  </Box>
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
              format="currency"
              icon="📈"
              color="dark"
            />
          </MDBox>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <MDBox mb={1.5}>
            <KpiCard
              title="Gross Margin"
              dataUrl="/api/v1/analytics/gross-margin?shop_id=1"
              format="percentage"
              icon="💰"
              color="success"
            />
          </MDBox>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <MDBox mb={1.5}>
            <KpiCard
              title="Total Inventory Value"
              dataUrl="/api/v1/analytics/inventory-value?shop_id=1"
              format="currency"
              icon="📦"
              color="primary"
            />
          </MDBox>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <MDBox mb={1.5}>
            <KpiCard
              title="Cost of Stockout"
              dataUrl="/api/v1/analytics/cost-of-stockout?shop_id=1&sku=STOCKOUT-SKU-01"
              format="currency"
              icon="⚠️"
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