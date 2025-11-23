/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/pages/Order360Page.tsx
import React from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Box, CircularProgress, Typography, Alert, Card, CardContent, Chip } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import ContextPanel, { ContextPanelTab } from 'ui-component/ContextPanel/index.tsx';
import WmsStatusStepper, { OrderStatus } from 'ui-component/WmsStatusStepper/index.tsx';
import { extractShopifyId } from 'utils/shopifyIdExtractor';

// --- DEFINE API RESPONSE INTERFACE BASED ON ACTUAL API ---
interface Order360ApiResponse {
  id: string;
  status: string;
  customer: {
    profile: {
      name: string;
      email: string;
      phone: string;
      tags: string[];
      shippingAddress: any;
      billingAddress: any;
      accountCreated: string;
      source: string;
    };
    metrics: {
      ltv: number;
      aov: number | string;
      totalOrders: number;
      totalMargin: number;
      lastOrderDate: string;
    };
  };
  profitability: {
    orderId: string;
    revenue: number | string;
    cogs: number | string;
    shippingCost: number | string;
    fees: number | string;
    margin: number | string;
    marginPercent: number;
  };
}

/**
 * Helper function to format currency values safely
 */
const formatCurrency = (value: number | string): string => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(numValue);
};

/**
 * Helper function to format numbers safely
 */
const formatNumber = (value: number | string): string => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  return numValue.toFixed(2);
};

/**
 * The Order 360 Page: Displays comprehensive details for a single order.
 */
const Order360Page: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  
  // Extract numeric ID from Shopify GID if needed
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
          
          {orderData && (
            <>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Order Information</Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
                    <Typography variant="body1"><strong>Order #:</strong> {extractShopifyId(orderData.id)}</Typography>
                    <Chip 
                      label={orderData.status.toUpperCase()} 
                      color={
                        orderData.status === 'fulfilled' ? 'success' :
                        orderData.status === 'pending' ? 'warning' : 'default'
                      }
                      size="small"
                    />
                  </Box>
                  <WmsStatusStepper currentStatus={orderData.status as OrderStatus} />
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Customer Information</Typography>
                  <Typography><strong>Name:</strong> {orderData.customer.profile.name}</Typography>
                  <Typography><strong>Email:</strong> {orderData.customer.profile.email}</Typography>
                  <Typography><strong>Source:</strong> {orderData.customer.profile.source}</Typography>
                  <Typography><strong>Account Created:</strong> {new Date(orderData.customer.profile.accountCreated).toLocaleDateString()}</Typography>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Financial Summary</Typography>
                  <Typography><strong>Revenue:</strong> {formatCurrency(orderData.profitability.revenue)}</Typography>
                  <Typography><strong>Margin:</strong> {formatCurrency(orderData.profitability.margin)} ({orderData.profitability.marginPercent}%)</Typography>
                  <Typography variant="body2" color="text.secondary">
                    <strong>COGS:</strong> {formatCurrency(orderData.profitability.cogs)} • 
                    <strong> Shipping:</strong> {formatCurrency(orderData.profitability.shippingCost)} • 
                    <strong> Fees:</strong> {formatCurrency(orderData.profitability.fees)}
                  </Typography>
                </CardContent>
              </Card>
            </>
          )}
        </Box>
      ),
    },
    {
      label: 'Customer 360',
      content: orderData ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Customer Profile</Typography>
              <Typography><strong>Name:</strong> {orderData.customer.profile.name}</Typography>
              <Typography><strong>Email:</strong> {orderData.customer.profile.email}</Typography>
              <Typography><strong>Phone:</strong> {orderData.customer.profile.phone || 'Not provided'}</Typography>
              <Typography><strong>Account Created:</strong> {new Date(orderData.customer.profile.accountCreated).toLocaleDateString()}</Typography>
              <Typography><strong>Source:</strong> {orderData.customer.profile.source}</Typography>
              {orderData.customer.profile.tags.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2"><strong>Tags:</strong></Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                    {orderData.customer.profile.tags.map((tag, index) => (
                      <Chip key={index} label={tag} size="small" variant="outlined" />
                    ))}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Customer Metrics</Typography>
              <Typography><strong>Lifetime Value:</strong> {formatCurrency(orderData.customer.metrics.ltv)}</Typography>
              <Typography><strong>Average Order Value:</strong> {formatCurrency(orderData.customer.metrics.aov)}</Typography>
              <Typography><strong>Total Orders:</strong> {orderData.customer.metrics.totalOrders}</Typography>
              <Typography><strong>Total Margin:</strong> {formatCurrency(orderData.customer.metrics.totalMargin)}</Typography>
              <Typography><strong>Last Order:</strong> {new Date(orderData.customer.metrics.lastOrderDate).toLocaleDateString()}</Typography>
            </CardContent>
          </Card>
        </Box>
      ) : (
        <Typography>Loading customer data...</Typography>
      ),
    },
    {
      label: 'Profitability',
      content: orderData ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Revenue Breakdown</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">Revenue</Typography>
                  <Typography variant="h6" color="success.main">
                    {formatCurrency(orderData.profitability.revenue)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">Margin</Typography>
                  <Typography variant="h6" color={orderData.profitability.marginPercent >= 20 ? 'success.main' : 'warning.main'}>
                    {formatCurrency(orderData.profitability.margin)} ({orderData.profitability.marginPercent}%)
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Cost Breakdown</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Cost of Goods Sold</Typography>
                  <Typography variant="body2" color="error.main">
                    -{formatCurrency(orderData.profitability.cogs)}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Shipping Cost</Typography>
                  <Typography variant="body2" color="error.main">
                    -{formatCurrency(orderData.profitability.shippingCost)}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Fees</Typography>
                  <Typography variant="body2" color="error.main">
                    -{formatCurrency(orderData.profitability.fees)}
                  </Typography>
                </Box>
                <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1, mt: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body1"><strong>Net Margin</strong></Typography>
                    <Typography variant="body1" color={orderData.profitability.marginPercent >= 20 ? 'success.main' : 'warning.main'}>
                      <strong>{formatCurrency(orderData.profitability.margin)}</strong>
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>
      ) : (
        <Typography>Loading profitability data...</Typography>
      ),
    },
    {
      label: 'Actions & Assist',
      content: (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>AI Recommendations</Typography>
            <Typography color="text.secondary">
              AI-powered insights and action recommendations will appear here based on order patterns and customer behavior.
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Chip label="Coming Soon" variant="outlined" color="primary" />
            </Box>
          </CardContent>
        </Card>
      ),
    },
  ];

  // Extract display order number
  const displayOrderNumber = orderData ? extractShopifyId(orderData.id) : orderId;

  return (
    <Box sx={{ p: 2, height: '100%' }}>
      <Typography variant="h4" gutterBottom>
        Order #{displayOrderNumber}
      </Typography>
      <ContextPanel tabs={tabs} />
    </Box>
  );
};

export default Order360Page;