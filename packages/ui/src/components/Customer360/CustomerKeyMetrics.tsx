/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/Customer360/CustomerKeyMetrics.tsx
import React from 'react';
import { Box, Grid, Stack, Typography, Paper } from '@mui/material';

// Define the structure for the data prop
export interface CustomerMetricsData {
  ltv: number | null | undefined;
  aov: number | null | undefined;
  totalOrders: number | null | undefined;
  totalMargin: number | null | undefined; // Added based on test
  lastOrderDate: string | null | undefined; // Expecting ISO string date
}

interface CustomerKeyMetricsProps {
  metrics: CustomerMetricsData | null | undefined;
}

/**
 * Formats a number as rounded USD currency (e.g., $1,205).
 */
const formatRoundedCurrency = (value: number | undefined | null): string => {
  if (value === null || typeof value === 'undefined') return '$--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
};

/**
 * Formats an ISO date string into a simple format (e.g., Oct 15, 2025).
 */
const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '--';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateString));
  } catch (e) {
    return '--'; // Handle invalid date strings
  }
};

/**
 * A component displaying key calculated metrics for a customer.
 */
const CustomerKeyMetrics: React.FC<CustomerKeyMetricsProps> = ({ metrics }) => {
  if (!metrics) {
    return (
      <Paper sx={{ p: 2 }}>
        <Typography variant="body2" color="textSecondary" align="center">
          Metrics data unavailable.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2 }}>
      {/* Use Grid to arrange the metrics */}
      <Grid container spacing={2} justifyContent="space-around" textAlign="center">
        {/* LTV */}
        <Grid size={{ xs: 12, sm: 4}} flexGrow={1}> {/* Use flexGrow for even distribution */}
          <Stack spacing={0.5}>
            <Typography variant="caption" color="textSecondary">Lifetime Value</Typography>
            <Typography variant="h5" data-testid="metric-ltv">{formatRoundedCurrency(metrics.ltv)}</Typography>
          </Stack>
        </Grid>

        {/* AOV */}
        <Grid size={{ xs: 12, sm: 4}} flexGrow={1}>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="textSecondary">Avg. Order Value</Typography>
            <Typography variant="h5" data-testid="metric-aov">{formatRoundedCurrency(metrics.aov)}</Typography>
          </Stack>
        </Grid>

        {/* Total Orders */}
       <Grid size={{ xs: 12, sm: 4}} flexGrow={1}>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="textSecondary">Total Orders</Typography>
            <Typography variant="h5" data-testid="metric-total-orders">{metrics.totalOrders ?? '--'}</Typography>
          </Stack>
        </Grid>

        {/* Total Margin */}
        <Grid size={{ xs: 12, sm: 4}} flexGrow={1}>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="textSecondary">Total Margin</Typography>
            <Typography variant="h5" ata-testid="metric-total-margin">{formatRoundedCurrency(metrics.totalMargin)}</Typography>
          </Stack>
        </Grid>

        {/* Last Order Date */}
        <Grid size={{ xs: 12, sm: 4}} flexGrow={1}> {/* Takes more space on small screens */}
          <Stack spacing={0.5}>
            <Typography variant="caption" color="textSecondary">Last Order</Typography>
            <Typography variant="h5" data-testid="metric-last-order">{formatDate(metrics.lastOrderDate)}</Typography>
          </Stack>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default CustomerKeyMetrics;