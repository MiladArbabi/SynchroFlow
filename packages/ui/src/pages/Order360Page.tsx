// packages/ui/src/pages/Order360Page.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import ContextPanel, { ContextPanelTab } from 'ui-component/ContextPanel/index.tsx';
import WmsStatusStepper, { OrderStatus } from 'ui-component/WmsStatusStepper/index.tsx';
// Import the customer component types
import CustomerProfile, { CustomerProfileData } from 'components/Customer360/CustomerProfile.tsx';
import CustomerKeyMetrics, { CustomerMetricsData } from 'components/Customer360/CustomerKeyMetrics.tsx';
import { extractShopifyId } from 'utils/shopifyIdExtractor';

// --- DEFINE NEW CONSOLIDATED API RESPONSE ---
interface Order360ApiResponse {
  id: string;
  status: OrderStatus;
  customer: {
    profile: CustomerProfileData;
    metrics: CustomerMetricsData;
  };
}

/**
 * The Order 360 Page: Displays comprehensive details for a single order.
 */
const Order360Page: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  
// Extract numeric ID if it's a Shopify GID
const orderId = id ? extractShopifyId(id) : id;
console.log('🔍 Order360Page - Original ID from URL:', id);
console.log('🎯 Order360Page - Extracted ID for API:', orderId);

const fetchOrderDetails = async (orderId: string | undefined): Promise<Order360ApiResponse> => {
  if (!orderId) {
    throw new Error('Order ID is required');
  }
    console.log('🌐 Fetching order details for ID:', orderId);
    const { data } = await axios.get<Order360ApiResponse>(`/api/v1/orders/${orderId}`);
    return data;
  };

  const {
    data: orderData,
    isLoading,
    isError,
    error
  } = useQuery<Order360ApiResponse, Error>({
    queryKey: ['order', orderId],
    queryFn: () => fetchOrderDetails(orderId),
    enabled: !!orderId,
  });

  // Define tabs for the ContextPanel
  const tabs: ContextPanelTab[] = [
    {
      label: 'Summary',
      content: (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* We can use the single loading/error state */}
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {isError && (
            <Alert severity="error" sx={{ my: 2 }}>
              Failed to load order data: {error?.message}
            </Alert>
          )}
          
          {/* Render all components once data is available */}
          {orderData && (
            <>
              <WmsStatusStepper currentStatus={orderData.status} />
              <CustomerProfile customer={orderData.customer.profile} />
              <CustomerKeyMetrics metrics={orderData.customer.metrics} />
            </>
          )}
        </Box>
      ),
    },
    {
      label: 'Customer',
      content: <Typography>Customer details will go here.</Typography>,
    },
    {
      label: 'Actions & Assist',
      content: <Typography>Actions and AI suggestions will go here.</Typography>,
    },
  ];

  return (
    <Box sx={{ p: 2, height: '100%' }}>
      <Typography variant="h4" gutterBottom>Order #{id}</Typography>
      <ContextPanel tabs={tabs} />
    </Box>
  );
};

export default Order360Page; // Default export is conventional for pages