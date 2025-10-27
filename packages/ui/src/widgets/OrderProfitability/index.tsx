// packages/ui/src/widgets/OrderProfitability/index.tsx
import React from 'react';
import { Box, Grid, Stack, Typography } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';

// Define the structure for the data prop
export interface OrderProfitabilityData {
  revenue: number;
  cogs: number;
  shippingCost: number; // Included for completeness, though not displayed yet
  fees: number;         // Included for completeness, though not displayed yet
  margin: number;
  marginPercent: number; // Expecting number like 47.3
}

interface OrderProfitabilityProps {
  data: OrderProfitabilityData | null | undefined;
}

/**
 * Formats a number as rounded USD currency (e.g., $150).
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
 * Formats a number as a rounded percentage (e.g., 47%).
 */
const formatRoundedPercent = (value: number | undefined | null): string => {
  if (value === null || typeof value === 'undefined') return '--%';
  return `${Math.round(value)}%`;
};

/**
 * A widget displaying key profitability metrics for an order.
 */
const OrderProfitability: React.FC<OrderProfitabilityProps> = ({ data }) => {
  if (!data) {
    return (
      <MainCard title="Profitability">
        <Typography variant="body2" color="textSecondary" align="center" sx={{ p: 2 }}>
          Profitability data unavailable.
        </Typography>
      </MainCard>
    );
  }

  // Combine margin value and percentage
  const marginDisplay = `${formatRoundedCurrency(data.margin)} (${formatRoundedPercent(data.marginPercent)})`;

  return (
    <MainCard title="Profitability">
      <Box sx={{ p: 2 }}>
        <Grid container spacing={2} justifyContent="space-around" textAlign="center">
          {/* Revenue */}
          <Grid item xs={4}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="textSecondary">Revenue</Typography>
              <Typography variant="h5">{formatRoundedCurrency(data.revenue)}</Typography>
            </Stack>
          </Grid>

          {/* COGS */}
          <Grid item xs={4}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="textSecondary">COGS</Typography>
              <Typography variant="h5">{formatRoundedCurrency(data.cogs)}</Typography>
            </Stack>
          </Grid>

          {/* Margin */}
          <Grid item xs={4}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="textSecondary">Margin</Typography>
              {/* Use different color based on profit/loss */}
              <Typography 
                variant="h5" 
                color={data.margin >= 0 ? 'success.main' : 'error.main'}
                data-testid="profitability-margin"
                >
                {marginDisplay}
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Box>
    </MainCard>
  );
};

export default OrderProfitability;