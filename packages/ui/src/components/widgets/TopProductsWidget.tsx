// packages/ui/src/components/widgets/TopProductsWidget.tsx
import React from 'react';
import {
  Box,
  Typography,
  Skeleton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
} from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';
import { Trophy } from 'lucide-react';

// 1. Define the API response shape (from getTopProducts)
interface TopProductItem {
  id: string;
  title: string;
  totalSold: number;
}

// 2. Create the internal Presentational Component
const TopProductsContent: React.FC<
  WidgetContentProps & { items: TopProductItem[] }
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
          Error loading top products
        </Typography>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No top products data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <List dense>
        {items.map((product, index) => (
          <ListItem
            key={product.id}
            secondaryAction={
              <Chip size="small" label={`${product.totalSold} sold`} />
            }
          >
            <ListItemIcon sx={{ minWidth: '40px' }}>
              {index === 0 ? (
                <Trophy size={20} color="gold" />
              ) : (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ width: '20px', textAlign: 'center' }}
                >
                  {index + 1}
                </Typography>
              )}
            </ListItemIcon>
            <ListItemText
              primary={product.title}
              primaryTypographyProps={{
                fontWeight: index === 0 ? 'bold' : 'normal',
                noWrap: true,
                maxWidth: '200px', // Prevents super long titles from breaking layout
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

// 3. Create the "Smart" Container Component
export const TopProductsWidget: React.FC<
  Omit<EnhancedWidgetShellProps, 'children'>
> = (props) => {
  const { accessToken } = useAuth();

  const { data, isLoading, error } = useQuery<TopProductItem[]>({
    queryKey: ['dashboardTopProducts'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/top-products', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  const items = data || [];
  const isEmpty = !isLoading && items.length === 0;

  return (
    <TopProductsContent
      {...props}
      items={items}
      isLoading={isLoading}
      isEmpty={isEmpty}
      error={error?.message}
    />
  );
};