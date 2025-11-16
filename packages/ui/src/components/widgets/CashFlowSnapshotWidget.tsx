// packages/ui/src/components/widgets/CashFlowSnapshotWidget.tsx
import React from 'react';
import { Box, Typography, Grid, Chip, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext'; // Import useAuth to get the token

// 1. Define the API response shape (based on our dashboard.controller.ts scan)
interface PulseData {
  totalRevenue: number;
  orderCount: number;
  unfulfilledCount: number;
}

// 2. Create the internal Presentational Component
// This is the logic copied directly from mock-widgets.tsx
const CashFlowWidgetContent: React.FC<WidgetContentProps> = (props) => {
  const { currentValue, previousValue, format, isLoading, isEmpty, error } = props;

  const formatValue = (value: number, formatType: string) => {
    switch (formatType) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
        }).format(value);
      case 'percentage':
        return `${value}%`;
      case 'number':
        return value.toLocaleString();
      default:
        return value.toString();
    }
  };

  const calculateTrend = () => {
    if (!previousValue || previousValue === 0) return null;
    return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  };

  const trend = calculateTrend();
  const isPositive = trend !== null && trend >= 0;

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton">
        <Skeleton variant="rectangular" height={80} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading cash flow data
        </Typography>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No cash flow data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={2} alignItems="center">
        <Grid>
          <AccountBalanceWalletIcon
            sx={{
              fontSize: 40,
              color: currentValue >= 0 ? 'success.main' : 'error.main',
            }}
          />
        </Grid>
        <Grid >
          <Typography variant="h4" component="div" sx={{ fontWeight: 'bold' }}>
            {formatValue(currentValue, format)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Today's Revenue
          </Typography>
        </Grid>
        {trend !== null && (
          <Grid >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isPositive ? (
                <TrendingUpIcon sx={{ color: 'success.main' }} />
              ) : (
                <TrendingDownIcon sx={{ color: 'error.main' }} />
              )}
              <Chip
                label={`${isPositive ? '+' : ''}${trend.toFixed(1)}%`}
                size="small"
                color={isPositive ? 'success' : 'error'}
                variant="outlined"
              />
            </Box>
          </Grid>
        )}
        {currentValue < 0 && (
          <Grid >
            <Chip
              label="Critical: Negative Cash Flow"
              color="error"
              size="small"
              sx={{ mt: 1 }}
            />
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

// 3. Create the "Smart" Container Component
// This fetches data and passes it to the presentational component
export const CashFlowSnapshotWidget: React.FC<
  Omit<EnhancedWidgetShellProps, 'children' | 'currentValue' | 'format' | 'isLoading' | 'isEmpty'>
> = (props) => {
  const { accessToken } = useAuth();

  const { data, isLoading, error } = useQuery<PulseData>({
    queryKey: ['dashboardPulse'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/pulse', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  const isEmpty = !isLoading && (!data || data.totalRevenue === 0);

  return (
    <CashFlowWidgetContent
      {...props}
      currentValue={data?.totalRevenue || 0}
      // previousValue={...} // We can add this later
      format="currency"
      isLoading={isLoading}
      isEmpty={isEmpty}
      error={error?.message}
    />
  );
};