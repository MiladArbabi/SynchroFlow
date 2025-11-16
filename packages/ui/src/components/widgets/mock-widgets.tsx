/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/widgets/mock-widgets.tsx
import React from 'react';
import { Box, Typography, Grid, useTheme, Chip, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps } from './types';

export const OrderMetricsWidget: React.FC<EnhancedWidgetShellProps> = (props) => {
  const { currentValue, format, isLoading, isEmpty, error } = props;

  // Mock order metrics
  const orderMetrics = {
    totalOrders: 47,
    averageOrder: 125.50,
    conversionRate: 2.3,
  };

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton">
        <Skeleton variant="rectangular" height={100} />
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

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading order data
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={3}>
        <Grid >
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              {orderMetrics.totalOrders}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total Orders
            </Typography>
          </Box>
        </Grid>
        <Grid >
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              ${orderMetrics.averageOrder}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Avg. Order
            </Typography>
          </Box>
        </Grid>
        <Grid >
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              {orderMetrics.conversionRate}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Conversion
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};