/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/widgets/mock-widgets.tsx
import React from 'react';
import { Box, Typography, Grid, useTheme, Chip, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps } from './types';

export const InventoryAlertsWidget: React.FC<EnhancedWidgetShellProps> = (props) => {
  const { currentValue, format, isLoading, isEmpty, error } = props;

  // Mock inventory alerts data
  const mockAlerts = [
    { product: 'Product A', status: 'low', quantity: 5 },
    { product: 'Product B', status: 'out', quantity: 0 },
    { product: 'Product C', status: 'low', quantity: 3 },
  ];

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton">
        <Skeleton variant="rectangular" height={120} />
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No inventory alerts
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading inventory data
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Inventory Alerts
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {mockAlerts.map((alert, index) => (
          <Box
            key={index}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              p: 1,
              border: '1px solid',
              borderColor: alert.status === 'out' ? 'error.main' : 'warning.main',
              borderRadius: 1,
              bgcolor: alert.status === 'out' ? 'error.light' : 'warning.light',
            }}
          >
            <Typography variant="body2">{alert.product}</Typography>
            <Chip
              label={alert.status === 'out' ? 'Out of Stock' : `Low: ${alert.quantity}`}
              color={alert.status === 'out' ? 'error' : 'warning'}
              size="small"
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
};

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