// packages/ui/src/layouts/dashboard/index.tsx
// @mui material components
import Grid from "@mui/material/Grid";

// Material Dashboard 2 React components
import MDBox from "components/MDBox";

// Our SynchroFlow components
import DashboardLayout from "components/DashboardLayout";
import DashboardNavbar from "components/DashboardNavbar";
import Footer from "components/Footer";
import { KpiCard } from "components/KpiCard"; // Use our KpiCard

function Dashboard() {
  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox py={3}>
        {/* Main KPI Grid */}
        <Grid container spacing={3}>
          <Grid item xs={12} md={6} lg={3}>
            <MDBox mb={1.5}>
              <KpiCard
                title="Gross Revenue"
                dataUrl="/api/v1/analytics/gross-revenue?shop_id=1"
                dataKey="gross_revenue"
                formatAs="currency"
              />
            </MDBox>
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <MDBox mb={1.5}>
              <KpiCard
                title="Gross Margin"
                dataUrl="/api/v1/analytics/gross-margin?shop_id=1"
                dataKey="gross_margin_percentage"
                formatAs="percentage"
              />
            </MDBox>
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <MDBox mb={1.5}>
              <KpiCard
                title="Total Inventory Value"
                dataUrl="/api/v1/analytics/inventory-value?shop_id=1"
                dataKey="total_inventory_value"
                formatAs="currency"
              />
            </MDBox>
          </Grid>
          <Grid item xs={12} md={6} lg={3}>
            <MDBox mb={1.5}>
              <KpiCard title="Cash Conversion Cycle" value="--" isLoading={false} />
            </MDBox>
          </Grid>
        </Grid>
        {/* We will add charts and other components here in future tasks */}
      </MDBox>
      <Footer />
    </DashboardLayout>
  );
}

export default Dashboard;