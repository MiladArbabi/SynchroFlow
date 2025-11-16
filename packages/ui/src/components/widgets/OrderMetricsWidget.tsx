// packages/ui/src/components/widgets/OrderMetricsWidget.tsx
import React from 'react';
import { Box, Typography, Grid, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';

// 1. Define the API response shape (from getPulse)
interface PulseData {
  totalRevenue: number;
  orderCount: number;
  unfulfilledCount: number;
}

// 2. Create the internal Presentational Component
// This is the logic copied directly from mock-widgets.tsx
const OrderMetricsContent: React.FC<
  WidgetContentProps & { totalOrders: number; averageOrder: number }
> = (props) => {
  const { isLoading, isEmpty, error, totalOrders, averageOrder } = props;

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton">
        <Skeleton variant="rectangular" height={100} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading order data
        </Typography>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No order data available
        </Typography>
      </Box>
    );
  }

  // Helper to format currency
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={3} justifyContent="space-around">
        <Grid >
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              {totalOrders}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total Orders
            </Typography>
          </Box>
        </Grid>
        <Grid >
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              {formatCurrency(averageOrder)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Avg. Order
            </Typography>
          </Box>
        </Grid>
        {/* We are intentionally leaving out 'Conversion' as our API doesn't supply it yet */}
      </Grid>
    </Box>
  );
};

// 3. Create the "Smart" Container Component
export const OrderMetricsWidget: React.FC<
  Omit<EnhancedWidgetShellProps, 'children'>
> = (props) => {
  const { accessToken } = useAuth();

  const { data, isLoading, error } = useQuery<PulseData>({
    queryKey: ['dashboardPulse'], // We reuse the same query as CashFlow
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/pulse', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken,
  });

  // Calculate metrics
  const totalOrders = data?.orderCount || 0;
  const totalRevenue = data?.totalRevenue || 0;
  // Calculate AOV, protecting against division by zero
  const averageOrder =
    totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const isEmpty = !isLoading && totalOrders === 0;

  return (
    <OrderMetricsContent
      {...props}
      totalOrders={totalOrders}
      averageOrder={averageOrder}
      isLoading={isLoading}
      isEmpty={isEmpty}
      error={error?.message}
    />
  );
};