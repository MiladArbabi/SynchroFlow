// packages/ui/src/components/widgets/SalesByTrafficSourceWidget.tsx
import React from 'react';
import {
  Box,
  Typography,
  Skeleton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Tooltip,
} from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';
import { Globe } from 'lucide-react';

// 1. Define the API response shape (from getSalesByTrafficSource)
interface TrafficSourceItem {
  source: string;
  totalRevenue: number;
  orderCount: number;
}

// Helper to format currency
const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

// 2. Create the internal Presentational Component
const TrafficSourceContent: React.FC<
  WidgetContentProps & { items: TrafficSourceItem[] }
> = (props) => {
  const { isLoading, isEmpty, error, items } = props;

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton" sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={150} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading traffic source data
        </Typography>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No traffic source data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <List dense>
        {items.map((item) => (
          <ListItem
            key={item.source}
            secondaryAction={
              <Typography variant="body2" fontWeight="bold">
                {formatCurrency(item.totalRevenue)}
              </Typography>
            }
          >
            <ListItemIcon sx={{ minWidth: '40px' }}>
              <Globe size={20} />
            </ListItemIcon>
            <ListItemText
              primary={
                <Tooltip title={item.source} arrow>
                  <Typography variant="body2" noWrap maxWidth="150px">
                    {item.source}
                  </Typography>
                </Tooltip>
              }
              secondary={`${item.orderCount} orders`}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

// 3. Create the "Smart" Container Component
export const SalesByTrafficSourceWidget: React.FC<
  Omit<EnhancedWidgetShellProps, 'children'>
> = (props) => {
  const { accessToken } = useAuth();

  const { data, isLoading, error } = useQuery<TrafficSourceItem[]>({
    queryKey: ['dashboardTrafficSource'],
    queryFn: async () => {
      const { data } = await axios.get(
        '/api/v1/dashboard/sales-by-traffic-source',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  const items = data || [];
  const isEmpty = !isLoading && items.length === 0;

  return (
    <TrafficSourceContent
      {...props}
      items={items}
      isLoading={isLoading}
      isEmpty={isEmpty}
      error={error?.message}
    />
  );
};