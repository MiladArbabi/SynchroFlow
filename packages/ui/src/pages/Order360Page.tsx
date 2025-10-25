// packages/ui/src/pages/Order360Page.tsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography } from '@mui/material';
import ContextPanel, { ContextPanelTab } from 'ui-component/ContextPanel/index.tsx';
import WmsStatusStepper, { OrderStatus } from 'ui-component/WmsStatusStepper/index.tsx';

// Define the expected API response structure
interface OrderStatusResponse {
  orderId: string;
  status: OrderStatus;
}

/**
 * The Order 360 Page: Displays comprehensive details for a single order.
 */
const Order360Page: React.FC = () => {
  const { id } = useParams<{ id: string }>(); // Get order ID from URL
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrderStatus = async () => {
      if (!id) return; // Guard against missing ID
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get<OrderStatusResponse>(`/api/v1/orders/${id}/status`);
        setOrderStatus(response.data.status);
      } catch (err) {
        console.error('Failed to fetch order status:', err);
        setError('Failed to load order status.');
      } finally {
        setLoading(false);
      }
    };

    fetchOrderStatus();
  }, [id]); // Re-fetch if the order ID changes

  // Define tabs for the ContextPanel
  const tabs: ContextPanelTab[] = [
    {
      label: 'Summary',
      content: (
        <Box>
          {loading && <CircularProgress />}
          {error && <Typography color="error">{error}</Typography>}
          {orderStatus && <WmsStatusStepper currentStatus={orderStatus} />}
          {/* Other summary widgets will go here */}
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
    // The page uses the ContextPanel directly
    // (MasterPanel will be on a separate '/orders' list page)
    <Box sx={{ p: 2, height: '100%' }}>
      <Typography variant="h4" gutterBottom>Order #{id}</Typography>
      <ContextPanel tabs={tabs} />
    </Box>
  );
};

export default Order360Page; // Default export is conventional for pages