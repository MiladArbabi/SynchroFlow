// packages/ui/src/components/widgets/InventoryAlertsWidget.tsx
import React from 'react';
import { Box, Typography, Chip, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';

// 1. Define the API response shape (from getInventoryHealth)
interface InventoryAlertItem {
  id: string;
  title: string;
  total_inventory: number;
}

// 2. Create the internal Presentational Component
// This is the logic copied directly from mock-widgets.tsx
const InventoryAlertsContent: React.FC<
  WidgetContentProps & { items: InventoryAlertItem[] }
> = (props) => {
  const { isLoading, isEmpty, error, items } = props;

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton">
        <Skeleton variant="rectangular" height={120} />
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

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No inventory alerts
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
        {items.map((alert) => {
          const isOutOfStock = alert.total_inventory <= 0;
          const status = isOutOfStock ? 'out' : 'low';
          const label = isOutOfStock
            ? 'Out of Stock'
            : `Low: ${alert.total_inventory}`;

          return (
            <Box
              key={alert.id}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 1,
                border: '1px solid',
                borderColor:
                  status === 'out' ? 'error.main' : 'warning.main',
                borderRadius: 1,
                bgcolor: status === 'out' ? 'error.light' : 'warning.light',
              }}
            >
              <Typography variant="body2">{alert.title}</Typography>
              <Chip
                label={label}
                color={status === 'out' ? 'error' : 'warning'}
                size="small"
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

// 3. Create the "Smart" Container Component
export const InventoryAlertsWidget: React.FC<
  Omit<EnhancedWidgetShellProps, 'children'>
> = (props) => {
  const { accessToken } = useAuth();

  const { data, isLoading, error } = useQuery<InventoryAlertItem[]>({
    queryKey: ['dashboardInventoryHealth'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/inventory-health', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  // Ensure items is always an array, even if API returns malformed data
  const items = Array.isArray(data) ? data : [];
  const isEmpty = !isLoading && items.length === 0;

  return (
    <InventoryAlertsContent
      {...props}
      items={items}
      isLoading={isLoading}
      isEmpty={isEmpty}
      error={error?.message}
    />
  );
};