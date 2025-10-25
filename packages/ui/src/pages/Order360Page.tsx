// packages/ui/src/pages/Order360Page.tsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography } from '@mui/material';
import ContextPanel, { ContextPanelTab } from 'ui-component/ContextPanel/index.tsx';
import WmsStatusStepper, { OrderStatus } from 'ui-component/WmsStatusStepper/index.tsx';
import OrderProfitability, { OrderProfitabilityData } from 'widgets/OrderProfitability/index.tsx';

// Define the expected API response structure
interface OrderStatusResponse {
  orderId: string;
  status: OrderStatus;
}

// --- PROFITABILITY RESPONSE TYPE ---
type OrderProfitabilityResponse = OrderProfitabilityData & { orderId: string };

/**
 * The Order 360 Page: Displays comprehensive details for a single order.
 */
const Order360Page: React.FC = () => {
  const { id } = useParams<{ id: string }>(); // Get order ID from URL
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);

  // --- SEPARATE LOADING/ERROR STATES ---
  const [statusLoading, setStatusLoading] = useState<boolean>(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [profitabilityData, setProfitabilityData] = useState<OrderProfitabilityData | null>(null);
  const [profitabilityLoading, setProfitabilityLoading] = useState<boolean>(true);
  const [profitabilityError, setProfitabilityError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrderStatus = async () => {
      if (!id) return; // Guard against missing ID
      setStatusLoading(true);
      setStatusError(null);
      try {
        const response = await axios.get<OrderStatusResponse>(`/api/v1/orders/${id}/status`);
        setOrderStatus(response.data.status);
      } catch (err) {
        console.error('Failed to fetch order status:', err);
        setStatusError('Failed to load order status.');
      } finally {
        setStatusLoading(false);
      }
    };

    // --- ADD PROFITABILITY FETCH LOGIC ---
    const fetchOrderProfitability = async () => {
      if (!id) return;
      setProfitabilityLoading(true);
      setProfitabilityError(null);
      try {
        const response = await axios.get<OrderProfitabilityResponse>(`/api/v1/orders/${id}/profitability`);
        setProfitabilityData(response.data);
      } catch (err) {
        console.error('Failed to fetch order profitability:', err);
        setProfitabilityError('Failed to load profitability data.');
      } finally {
        setProfitabilityLoading(false);
      }
    };

    fetchOrderStatus();
    fetchOrderProfitability();
  }, [id]); // Re-fetch if the order ID changes

  // Define tabs for the ContextPanel
  const tabs: ContextPanelTab[] = [
    {
      label: 'Summary',
      content: (
        <Box>
          {statusLoading && <CircularProgress size={20} />}
          {statusError && <Typography color="error" variant="body2">{statusError}</Typography>}
          {orderStatus && <WmsStatusStepper currentStatus={orderStatus} />}
          {/* Profitability Section */}
          {profitabilityLoading && <CircularProgress size={20} />}
          {profitabilityError && <Typography color="error" variant="body2">{profitabilityError}</Typography>}
          {profitabilityData && <OrderProfitability data={profitabilityData} />}
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